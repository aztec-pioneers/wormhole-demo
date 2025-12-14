package submitter

import (
	"context"
	"time"

	"go.uber.org/zap"

	"github.com/wormhole-demo/relayer/internal/clients"
)

type AztecSubmitter struct {
	targetContract     string
	verificationClient *clients.VerificationServiceClient
	logger             *zap.Logger
}

func NewAztecSubmitter(logger *zap.Logger, targetContract string, verificationClient *clients.VerificationServiceClient) *AztecSubmitter {
	return &AztecSubmitter{
		targetContract:     targetContract,
		verificationClient: verificationClient,
		logger:             logger.With(zap.String("component", "AztecSubmitter")),
	}
}

func (s *AztecSubmitter) SubmitVAA(ctx context.Context, vaaBytes []byte) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	s.logger.Info("Submitting VAA to Aztec",
		zap.Int("vaaLength", len(vaaBytes)),
		zap.String("targetContract", s.targetContract))

	txHash, err := s.verificationClient.VerifyVAA(ctx, vaaBytes)
	if err != nil {
		s.logger.Error("Failed to submit VAA to Aztec", zap.Error(err))
		return "", err
	}

	s.logger.Info("VAA successfully submitted to Aztec",
		zap.String("txHash", txHash),
		zap.String("targetContract", s.targetContract))

	return txHash, nil
}
