package submitter

import (
	"context"
	"encoding/binary"
	"fmt"
	"time"

	"go.uber.org/zap"

	"github.com/wormhole-demo/relayer/internal/clients"
)

// SolanaSubmitter handles submission of VAAs to Solana
type SolanaSubmitter struct {
	solanaClient *clients.SolanaClient
	logger       *zap.Logger
}

// NewSolanaSubmitter creates a new Solana submitter instance
func NewSolanaSubmitter(logger *zap.Logger, solanaClient *clients.SolanaClient) *SolanaSubmitter {
	return &SolanaSubmitter{
		solanaClient: solanaClient,
		logger:       logger.With(zap.String("component", "SolanaSubmitter")),
	}
}

// SubmitVAA submits the given VAA bytes to the Solana MessageBridge and returns the transaction signature or an error
func (s *SolanaSubmitter) SubmitVAA(ctx context.Context, vaaBytes []byte) (string, error) {
	// Create a context with timeout for submission operations
	ctx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()

	s.logger.Info("Submitting VAA to Solana",
		zap.Int("vaaLength", len(vaaBytes)),
		zap.String("programID", s.solanaClient.GetProgramID().String()),
		zap.String("payer", s.solanaClient.GetPayerAddress().String()))

	// Parse VAA to extract emitter chain and sequence
	emitterChain, sequence, err := parseVAAHeader(vaaBytes)
	if err != nil {
		return "", fmt.Errorf("failed to parse VAA header: %w", err)
	}

	s.logger.Debug("Parsed VAA header",
		zap.Uint16("emitterChain", emitterChain),
		zap.Uint64("sequence", sequence))

	// Try to post VAA and wait for it with retries
	maxRetries := 10
	retryDelay := 3 * time.Second
	var lastErr error

	for attempt := 1; attempt <= maxRetries; attempt++ {
		// Check/post VAA to Wormhole
		_, err = s.solanaClient.PostVAAToWormhole(ctx, vaaBytes)
		if err == nil {
			s.logger.Info("VAA is posted to Wormhole, proceeding with receive_value")
			break
		}

		lastErr = err
		if attempt < maxRetries {
			s.logger.Info("Waiting for VAA to be posted to Wormhole",
				zap.Int("attempt", attempt),
				zap.Int("maxRetries", maxRetries),
				zap.Duration("nextRetry", retryDelay))
			select {
			case <-ctx.Done():
				return "", fmt.Errorf("context cancelled while waiting for VAA: %w", ctx.Err())
			case <-time.After(retryDelay):
				retryDelay = retryDelay * 3 / 2 // Increase delay
				if retryDelay > 15*time.Second {
					retryDelay = 15 * time.Second
				}
			}
		}
	}

	if lastErr != nil && err != nil {
		s.logger.Warn("VAA may not be fully posted, attempting receive_value anyway", zap.Error(lastErr))
	}

	// Submit receive_value transaction
	sig, err := s.solanaClient.SendReceiveValueTransaction(ctx, vaaBytes, emitterChain, sequence)
	if err != nil {
		return "", fmt.Errorf("failed to submit VAA to Solana: %w", err)
	}

	s.logger.Info("VAA successfully submitted to Solana",
		zap.String("signature", sig),
		zap.Uint16("emitterChain", emitterChain),
		zap.Uint64("sequence", sequence))

	return sig, nil
}

// parseVAAHeader extracts emitter chain and sequence from VAA bytes
func parseVAAHeader(vaaBytes []byte) (emitterChain uint16, sequence uint64, err error) {
	// VAA structure:
	// - 1 byte: version
	// - 4 bytes: guardian set index
	// - 1 byte: signature count
	// - 66 bytes per signature
	// Body starts after signatures:
	// - 4 bytes: timestamp
	// - 4 bytes: nonce
	// - 2 bytes: emitter chain
	// - 32 bytes: emitter address
	// - 8 bytes: sequence
	// - 1 byte: consistency level
	// - payload

	if len(vaaBytes) < 6 {
		return 0, 0, fmt.Errorf("VAA too short")
	}

	sigCount := int(vaaBytes[5])
	bodyStart := 6 + (sigCount * 66)

	// Body needs at least: 4 + 4 + 2 + 32 + 8 + 1 = 51 bytes
	if len(vaaBytes) < bodyStart+51 {
		return 0, 0, fmt.Errorf("VAA body too short")
	}

	body := vaaBytes[bodyStart:]

	// Emitter chain is at offset 8 (after timestamp and nonce), big-endian
	emitterChain = binary.BigEndian.Uint16(body[8:10])

	// Sequence is at offset 42 (after timestamp, nonce, emitter chain, emitter address), big-endian
	sequence = binary.BigEndian.Uint64(body[42:50])

	return emitterChain, sequence, nil
}
