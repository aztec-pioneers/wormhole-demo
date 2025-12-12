package internal

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"go.uber.org/zap"
)

// computeVAAKey computes a unique key for a VAA based on its bytes
func computeVAAKey(vaaBytes []byte) string {
	hash := sha256.Sum256(vaaBytes)
	return hex.EncodeToString(hash[:])
}

// parseAndLogPayload parses and logs payload structure at debug level
// Payload structure (3 bytes):
//   Bytes 0-1: destinationChainId (big-endian)
//   Byte 2:    value
func parseAndLogPayload(logger *zap.Logger, payload []byte) {
	if len(payload) < 3 {
		logger.Debug("Payload too short", zap.Int("length", len(payload)))
		return
	}

	// Parse destination chain ID (2 bytes, big-endian)
	destinationChainID := (uint16(payload[0]) << 8) | uint16(payload[1])

	// Parse value (1 byte)
	value := payload[2]

	logger.Debug("Payload parsed",
		zap.Uint16("destinationChainID", destinationChainID),
		zap.Uint8("value", value),
		zap.String("rawHex", fmt.Sprintf("0x%x", payload)))
}
