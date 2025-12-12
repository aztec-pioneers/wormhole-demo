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
// Payload structure (18 bytes):
//   Bytes 0-1:  destinationChainId (big-endian)
//   Bytes 2-17: value (uint128, big-endian)
func parseAndLogPayload(logger *zap.Logger, payload []byte) {
	if len(payload) < 18 {
		logger.Debug("Payload too short", zap.Int("length", len(payload)))
		return
	}

	// Parse destination chain ID (2 bytes, big-endian)
	destinationChainID := (uint16(payload[0]) << 8) | uint16(payload[1])

	// Parse value (16 bytes, big-endian) - display as hex string since Go doesn't have uint128
	valueHex := fmt.Sprintf("0x%x", payload[2:18])

	logger.Debug("Payload parsed",
		zap.Uint16("destinationChainID", destinationChainID),
		zap.String("value", valueHex),
		zap.String("rawHex", fmt.Sprintf("0x%x", payload)))
}
