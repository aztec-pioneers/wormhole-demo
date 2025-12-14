package internal

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wormhole-demo/relayer/internal/clients"
	"go.uber.org/zap"
)

type Relayer struct {
	spyClient    *clients.SpyClient
	vaaProcessor VAAProcessor
	logger       *zap.Logger
	// Protect against duplicate deliveries from the spy service (at-least-once semantics).
	dedupeMu      sync.Mutex
	inflightVAAs  map[string]struct{}
	processedVAAs map[string]time.Time
	dedupeTTL     time.Duration
}

// NewRelayer creates a new relayer instance
func NewRelayer(logger *zap.Logger, spyClient *clients.SpyClient, processor VAAProcessor) (*Relayer, error) {

	return &Relayer{
		logger:        logger.With(zap.String("component", "Relayer")),
		spyClient:     spyClient,
		vaaProcessor:  processor,
		inflightVAAs:  make(map[string]struct{}),
		processedVAAs: make(map[string]time.Time),
		dedupeTTL:     15 * time.Minute,
	}, nil
}

// beginProcessingVAA checks if we should process a VAA (returns false if duplicate)
func (r *Relayer) beginProcessingVAA(key string) bool {
	r.dedupeMu.Lock()
	defer r.dedupeMu.Unlock()

	// Drop if we already processed this VAA recently—spy service can replay messages.
	if ts, ok := r.processedVAAs[key]; ok {
		if time.Since(ts) < r.dedupeTTL {
			return false
		}
		delete(r.processedVAAs, key)
	}

	// Another goroutine is already working on this VAA; let it finish.
	if _, ok := r.inflightVAAs[key]; ok {
		return false
	}

	r.inflightVAAs[key] = struct{}{}
	return true
}

// finishProcessingVAA marks a VAA as done processing
func (r *Relayer) finishProcessingVAA(key string, success bool) {
	r.dedupeMu.Lock()
	defer r.dedupeMu.Unlock()

	delete(r.inflightVAAs, key)

	if success {
		// Cache the completion timestamp so replays are ignored within the TTL window.
		r.processedVAAs[key] = time.Now()
	}

	// Clean up old entries
	cutoff := time.Now().Add(-r.dedupeTTL)
	for k, ts := range r.processedVAAs {
		if ts.Before(cutoff) {
			delete(r.processedVAAs, k)
		}
	}
}

// Close cleans up resources used by the relayer
func (r *Relayer) Close() {
	if r.spyClient != nil {
		r.spyClient.Close()
	}
}

// Start begins listening for VAAs and processing them
func (r *Relayer) Start(ctx context.Context) error {
	// Create a wait group to track goroutines
	var wg sync.WaitGroup

	// Subscribe to VAAs
	stream, err := r.spyClient.SubscribeSignedVAA(ctx)
	if err != nil {
		return fmt.Errorf("subscribe to VAA stream: %v", err)
	}

	r.logger.Info("Listening for VAAs")

	// Create a separate context for graceful shutdown
	processingCtx, cancelProcessing := context.WithCancel(context.Background())
	defer cancelProcessing()

	for {
		select {
		case <-ctx.Done():
			r.logger.Info("Shutting down relayer")
			// Cancel all processing
			cancelProcessing()
			// Wait for all processing goroutines to complete
			r.logger.Info("Waiting for all VAA processing to complete")
			wg.Wait()
			r.logger.Info("Shutdown complete")
			return nil
		default:
			// Receive the next VAA
			resp, err := stream.Recv()
			if err != nil {
				r.logger.Warn("Stream error, retrying in 5s", zap.Error(err))
				time.Sleep(5 * time.Second)
				stream, err = r.spyClient.SubscribeSignedVAA(ctx)
				if err != nil {
					// Cancel all processing before returning
					cancelProcessing()
					// Wait for all processing goroutines to complete
					wg.Wait()
					return fmt.Errorf("subscribe to VAA stream after retry: %v", err)
				}
				continue
			}

			// Check for duplicates before processing
			key := computeVAAKey(resp.VaaBytes)
			if !r.beginProcessingVAA(key) {
				r.logger.Debug("Skipping duplicate VAA", zap.String("vaaHash", key))
				continue
			}

			// Process the VAA in a goroutine, but track it with the WaitGroup
			wg.Add(1)
			go func(vaaBytes []byte, dedupeKey string) {
				defer wg.Done()
				if err := r.processVAA(processingCtx, vaaBytes); err != nil {
					r.finishProcessingVAA(dedupeKey, false)
				} else {
					r.finishProcessingVAA(dedupeKey, true)
				}
			}(resp.VaaBytes, key)
		}
	}
}

func (r *Relayer) processVAA(ctx context.Context, vaaBytes []byte) error {
	// Check for context cancellation first
	select {
	case <-ctx.Done():
		r.logger.Debug("Processing cancelled for VAA")
		return ctx.Err()
	default:
		// Continue processing
	}

	// Parse the VAA (using permissive parser that handles v1 and v2)
	wormholeVAA, err := ParseVAAPermissive(vaaBytes)
	if err != nil {
		r.logger.Error("Failed to parse VAA", zap.Error(err))
		return err
	}

	// Extract the txID from the payload (first 32 bytes)
	txID := ""
	if len(wormholeVAA.Payload) >= 32 {
		txIDBytes := wormholeVAA.Payload[:32]
		txID = fmt.Sprintf("0x%x", txIDBytes)
		r.logger.Debug("Extracted txID from payload", zap.String("txID", txID))
	} else {
		r.logger.Debug("Payload too short to contain txID", zap.Int("payload_length", len(wormholeVAA.Payload)))
	}

	// Create VAA data with essential information
	vaaData := &VAAData{
		VAA:        wormholeVAA,
		RawBytes:   vaaBytes,
		ChainID:    uint16(wormholeVAA.EmitterChain),
		EmitterHex: fmt.Sprintf("%064x", wormholeVAA.EmitterAddress),
		Sequence:   wormholeVAA.Sequence,
		TxID:       txID,
	}

	r.logger.Debug("Processing VAA",
		zap.Uint16("chain", vaaData.ChainID),
		zap.Uint64("sequence", vaaData.Sequence),
		zap.String("emitter", vaaData.EmitterHex),
		zap.String("sourceTxID", vaaData.TxID))

	// Use the passed context when calling the processor
	if _, err := r.vaaProcessor.ProcessVAA(ctx, *vaaData); err != nil {
		r.logger.Error("Error processing VAA", zap.Error(err))
		return err
	}

	return nil
}
