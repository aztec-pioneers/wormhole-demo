package internal

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wormhole-demo/relayer/internal/submitter"
	"go.uber.org/zap"
)

type VAAProcessor interface {
	// ProcessVAA processes the given VAA bytes and returns the transaction hash or an error
	ProcessVAA(ctx context.Context, vaaData VAAData) (string, error)
}

type VAAProcessorConfig struct {
	ChainID        uint16
	EmitterAddress string // Hex-encoded emitter address to filter (empty = no filter)
}

type DefaultVAAProcessor struct {
	config    VAAProcessorConfig
	logger    *zap.Logger
	submitter submitter.VAASubmitter
}

func NewDefaultVAAProcessor(logger *zap.Logger, config VAAProcessorConfig, submitter submitter.VAASubmitter) *DefaultVAAProcessor {
	// Normalize emitter address: remove 0x prefix, lowercase, pad to 64 chars
	if config.EmitterAddress != "" {
		addr := strings.TrimPrefix(config.EmitterAddress, "0x")
		addr = strings.ToLower(addr)
		// Left-pad to 64 characters (32 bytes)
		for len(addr) < 64 {
			addr = "0" + addr
		}
		config.EmitterAddress = addr
	}

	return &DefaultVAAProcessor{
		config:    config,
		logger:    logger.With(zap.String("component", "DefaultVAAProcessor")),
		submitter: submitter,
	}
}

func (p *DefaultVAAProcessor) ProcessVAA(ctx context.Context, vaaData VAAData) (string, error) {
	// Create a context with timeout for processing operations
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute) // 5 minute timeout for Aztec VAA verification
	defer cancel()

	// Log VAAs from Aztec (54 or 56) or Arbitrum Sepolia (10003) at INFO level before filtering
	if vaaData.ChainID == 54 || vaaData.ChainID == 56 || vaaData.ChainID == 10003 {
		chainName := "Aztec"
		if vaaData.ChainID == 10003 {
			chainName = "Arbitrum Sepolia"
		}
		p.logger.Info("Received VAA from target chain",
			zap.String("chain", chainName),
			zap.Uint16("chainId", vaaData.ChainID),
			zap.String("emitter", vaaData.EmitterHex),
			zap.Uint64("sequence", vaaData.Sequence),
			zap.String("sourceTxID", vaaData.TxID))
	}

	// Log essential VAA information at debug level
	p.logger.Debug("VAA Details",
		zap.Uint16("emitterChain", vaaData.ChainID),
		zap.String("emitterAddress", vaaData.EmitterHex),
		zap.Uint64("sequence", vaaData.Sequence),
		zap.Time("timestamp", vaaData.VAA.Timestamp),
		zap.Int("payloadLength", len(vaaData.VAA.Payload)),
		zap.String("sourceTxID", vaaData.TxID))

	// Extract and log key payload information at debug level
	p.logger.Debug("VAA Payload", zap.String("payloadHex", fmt.Sprintf("%x", vaaData.VAA.Payload)))

	// Parse payload structure at debug level
	if len(vaaData.VAA.Payload) >= 32 {
		parseAndLogPayload(p.logger, vaaData.VAA.Payload)
	}

	// Check if this is a VAA from our configured source chain
	if vaaData.ChainID != p.config.ChainID {
		// Skip VAAs not from our configured chain
		p.logger.Debug("Skipping VAA (not from configured chain)",
			zap.Uint64("sequence", vaaData.Sequence),
			zap.Uint16("chain", vaaData.ChainID))
		return "", nil
	}

	// Check if this VAA is from our configured emitter address
	if p.config.EmitterAddress != "" && vaaData.EmitterHex != p.config.EmitterAddress {
		p.logger.Debug("Skipping VAA (not from configured emitter)",
			zap.Uint64("sequence", vaaData.Sequence),
			zap.String("emitter", vaaData.EmitterHex),
			zap.String("expectedEmitter", p.config.EmitterAddress))
		return "", nil
	}

	txHash, err := p.submitter.SubmitVAA(ctx, vaaData.RawBytes)
	if err != nil {
		// Check if the context was cancelled or timed out
		if ctx.Err() != nil {
			p.logger.Warn("Transaction sending cancelled or timed out", zap.Error(ctx.Err()))
			return "", fmt.Errorf("transaction interrupted: %v", ctx.Err())
		}

		p.logger.Error("Failed to send verify transaction",
			zap.Uint64("sequence", vaaData.Sequence),
			zap.String("sourceTxID", vaaData.TxID),
			zap.Error(err))
		return "", fmt.Errorf("transaction failed: %v", err)
	}

	p.logger.Info("VAA verification completed",
		zap.Uint64("sequence", vaaData.Sequence),
		zap.String("txHash", txHash),
		zap.String("sourceTxID", vaaData.TxID))

	return txHash, nil
}
