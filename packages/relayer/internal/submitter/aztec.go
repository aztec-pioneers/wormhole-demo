package submitter

import (
	"context"
	"time"

	"go.uber.org/zap"

	"github.com/wormhole-demo/relayer/internal/clients"
)

type AztecSubmitter struct {
	targetContract     string
	pxeClient          *clients.AztecPXEClient
	verificationClient *clients.VerificationServiceClient
	logger             *zap.Logger
}

func NewAztecSubmitter(logger *zap.Logger, targetContract string, pxeClient *clients.AztecPXEClient, verificationClient *clients.VerificationServiceClient) *AztecSubmitter {
	return &AztecSubmitter{
		targetContract:     targetContract,
		pxeClient:          pxeClient,
		verificationClient: verificationClient,
		logger:             logger.With(zap.String("component", "AztecSubmitter")),
	}
}

func (s *AztecSubmitter) SubmitVAA(ctx context.Context, vaaBytes []byte) (string, error) {
	// Create a context with timeout for submission operations (15 minutes for Aztec)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	s.logger.Info("Submitting VAA to Aztec",
		zap.Int("vaaLength", len(vaaBytes)),
		zap.String("targetContract", s.targetContract))

	var txHash string
	var err error

	// Try verification service first, fallback to direct PXE if available
	txHash, err = s.verificationClient.VerifyVAA(ctx, vaaBytes)
	if err != nil {
		if s.pxeClient != nil {
			s.logger.Warn("Verification service failed, trying direct PXE", zap.Error(err))
			// Fallback to direct PXE call
			txHash, err = s.pxeClient.SendVerifyTransaction(ctx, s.targetContract, vaaBytes)
		} else {
			s.logger.Error("Verification service failed and no PXE fallback available", zap.Error(err))
		}
	} else {
		s.logger.Debug("Used verification service successfully")
	}

	if err != nil {
		s.logger.Error("Failed to submit VAA to Aztec", zap.Error(err))
		return "", err
	}

	s.logger.Info("VAA successfully submitted to Aztec",
		zap.String("txHash", txHash),
		zap.String("targetContract", s.targetContract))

	return txHash, nil
}
