package internal

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"time"

	vaaLib "github.com/wormhole-foundation/wormhole/sdk/vaa"
	"go.uber.org/zap"
)

// ParseVAAPermissive parses a VAA without being strict about version.
// It handles both v1 and v2 VAAs by extracting the fields we need.
// The raw bytes are still passed to the on-chain contracts for proper verification.
func ParseVAAPermissive(data []byte) (*vaaLib.VAA, error) {
	if len(data) < 6 {
		return nil, fmt.Errorf("VAA too short: %d bytes", len(data))
	}

	version := data[0]
	if version != 1 && version != 2 {
		return nil, fmt.Errorf("unsupported VAA version: %d", version)
	}

	// VAA structure (same for v1 and v2):
	// 0: version (1 byte)
	// 1-4: guardian set index (4 bytes)
	// 5: signature count (1 byte)
	// 6+: signatures (66 bytes each: guardian index + signature)
	// After signatures: body

	guardianSetIndex := binary.BigEndian.Uint32(data[1:5])
	signatureCount := int(data[5])

	// Each signature is 66 bytes (1 byte index + 65 bytes signature)
	signatureSize := 66
	signaturesEnd := 6 + (signatureCount * signatureSize)

	if len(data) < signaturesEnd {
		return nil, fmt.Errorf("VAA too short for %d signatures", signatureCount)
	}

	// Body starts after signatures
	body := data[signaturesEnd:]

	// Body structure:
	// 0-3: timestamp (4 bytes)
	// 4-7: nonce (4 bytes)
	// 8-9: emitter chain (2 bytes)
	// 10-41: emitter address (32 bytes)
	// 42-49: sequence (8 bytes)
	// 50: consistency level (1 byte)
	// 51+: payload

	if len(body) < 51 {
		return nil, fmt.Errorf("VAA body too short: %d bytes", len(body))
	}

	timestamp := binary.BigEndian.Uint32(body[0:4])
	nonce := binary.BigEndian.Uint32(body[4:8])
	emitterChain := binary.BigEndian.Uint16(body[8:10])

	var emitterAddress vaaLib.Address
	copy(emitterAddress[:], body[10:42])

	sequence := binary.BigEndian.Uint64(body[42:50])
	consistencyLevel := body[50]

	payload := body[51:]

	// Parse signatures
	signatures := make([]*vaaLib.Signature, signatureCount)
	for i := 0; i < signatureCount; i++ {
		sigStart := 6 + (i * signatureSize)
		guardianIndex := data[sigStart]
		var sig [65]byte
		copy(sig[:], data[sigStart+1:sigStart+66])
		signatures[i] = &vaaLib.Signature{
			Index:     guardianIndex,
			Signature: sig,
		}
	}

	return &vaaLib.VAA{
		Version:          version,
		GuardianSetIndex: guardianSetIndex,
		Signatures:       signatures,
		Timestamp:        time.Unix(int64(timestamp), 0),
		Nonce:            nonce,
		Sequence:         sequence,
		ConsistencyLevel: consistencyLevel,
		EmitterChain:     vaaLib.ChainID(emitterChain),
		EmitterAddress:   emitterAddress,
		Payload:          payload,
	}, nil
}

// LogVAAFull logs all fields of a VAA for debugging
func LogVAAFull(logger *zap.Logger, vaa *vaaLib.VAA, rawBytes []byte) {
	logger.Debug("=== Full VAA Details ===",
		zap.Uint8("version", vaa.Version),
		zap.Uint32("guardianSetIndex", vaa.GuardianSetIndex),
		zap.Int("signatureCount", len(vaa.Signatures)),
		zap.Time("timestamp", vaa.Timestamp),
		zap.Uint32("nonce", vaa.Nonce),
		zap.Uint64("sequence", vaa.Sequence),
		zap.Uint8("consistencyLevel", vaa.ConsistencyLevel),
		zap.Uint16("emitterChain", uint16(vaa.EmitterChain)),
		zap.String("emitterAddress", hex.EncodeToString(vaa.EmitterAddress[:])),
		zap.Int("payloadLength", len(vaa.Payload)),
		zap.String("payloadHex", hex.EncodeToString(vaa.Payload)),
		zap.Int("rawBytesLength", len(rawBytes)),
	)

	// Log each signature
	for i, sig := range vaa.Signatures {
		logger.Debug("VAA Signature",
			zap.Int("index", i),
			zap.Uint8("guardianIndex", sig.Index),
			zap.String("signature", hex.EncodeToString(sig.Signature[:])),
		)
	}
}
