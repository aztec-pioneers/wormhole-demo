package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"

	"github.com/wormhole-demo/relayer/internal"
	"github.com/wormhole-demo/relayer/internal/clients"
	"github.com/wormhole-demo/relayer/internal/submitter"
)

const (
	DefaultAztecTargetContract    = "0x0848d2af89dfd7c0e171238f9216399e61e908cd31b0222a920f1bf621a16ed6"
	DefaultVerificationServiceURL = "http://localhost:8080"

	// Wormhole chain ID for Aztec
	AztecDestinationChainID uint16 = 56
)

// Default source chains for Aztec destination (Arbitrum=10003, Solana=1, Base=10004)
var DefaultAztecSourceChains = []int{10003, 1, 10004}

// aztecCmd represents the command to relay VAAs to Aztec
var aztecCmd = &cobra.Command{
	Use:   "aztec",
	Short: "Relay Wormhole VAAs to Aztec",
	Long: `Listens for Wormhole VAAs from configured source chains and relays them to Aztec.

This command monitors the Wormhole network for messages from EVM chains, Solana,
or other configured chains and submits them to the Aztec network via the VAA service.`,
	PreRun: func(cmd *cobra.Command, args []string) {
		printBanner()
		configureLogging(cmd, args)
	},
	RunE: runAztecRelay,
}

func init() {
	rootCmd.AddCommand(aztecCmd)

	aztecCmd.Flags().String(
		"aztec-target-contract",
		DefaultAztecTargetContract,
		"Target contract on Aztec to send VAAs to")

	aztecCmd.Flags().String(
		"verification-service-url",
		DefaultVerificationServiceURL,
		"VAA verification service URL")

	aztecCmd.Flags().IntSlice(
		"chain-ids",
		DefaultAztecSourceChains,
		"Source chain IDs to listen for (Arbitrum=10003, Solana=1, Base=10004)")

	aztecCmd.Flags().String(
		"emitter-address",
		"",
		"Source emitter address to filter (hex, e.g., EVM bridge address)")

	viper.BindPFlag("aztec_target_contract", aztecCmd.Flags().Lookup("aztec-target-contract"))
	viper.BindPFlag("verification_service_url", aztecCmd.Flags().Lookup("verification-service-url"))
	viper.BindPFlag("chain_ids", aztecCmd.Flags().Lookup("chain-ids"))
	viper.BindPFlag("emitter_address", aztecCmd.Flags().Lookup("emitter-address"))
}

type AztecConfig struct {
	SpyRPCHost             string
	ChainIDs               []uint16
	AztecTargetContract    string
	VerificationServiceURL string
	EmitterAddress         string
}

func runAztecRelay(cmd *cobra.Command, args []string) error {
	logger := configureLogging(cmd, args)
	logger.Info("Starting Aztec relayer")

	emitterAddress, _ := cmd.Flags().GetString("emitter-address")
	chainIDsInt, _ := cmd.Flags().GetIntSlice("chain-ids")

	chainIDs := make([]uint16, len(chainIDsInt))
	for i, id := range chainIDsInt {
		chainIDs[i] = uint16(id)
	}

	config := AztecConfig{
		SpyRPCHost:             viper.GetString("spy_rpc_host"),
		ChainIDs:               chainIDs,
		AztecTargetContract:    viper.GetString("aztec_target_contract"),
		VerificationServiceURL: viper.GetString("verification_service_url"),
		EmitterAddress:         emitterAddress,
	}

	logger.Info("Configuration",
		zap.String("spyRPC", config.SpyRPCHost),
		zap.Any("chainIds", config.ChainIDs),
		zap.String("aztecTarget", config.AztecTargetContract),
		zap.String("verificationService", config.VerificationServiceURL),
		zap.String("emitterFilter", config.EmitterAddress))

	spyClient, err := clients.NewSpyClient(logger, config.SpyRPCHost)
	if err != nil {
		return fmt.Errorf("failed to create spy client: %v", err)
	}

	// Check verification service health
	verificationService := clients.NewVerificationServiceClient(logger, config.VerificationServiceURL)
	healthCtx, healthCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer healthCancel()

	if err := verificationService.CheckHealth(healthCtx); err != nil {
		return fmt.Errorf("verification service not available: %v", err)
	}
	logger.Info("Connected to verification service", zap.String("url", config.VerificationServiceURL))

	aztecSubmitter := submitter.NewAztecSubmitter(logger, config.AztecTargetContract, verificationService)
	vaaProcessor := internal.NewDefaultVAAProcessor(logger,
		internal.VAAProcessorConfig{
			ChainIDs:           config.ChainIDs,
			EmitterAddress:     config.EmitterAddress,
			DestinationChainID: AztecDestinationChainID,
		},
		aztecSubmitter)

	relayer, err := internal.NewRelayer(logger, spyClient, vaaProcessor)
	if err != nil {
		return fmt.Errorf("failed to initialize relayer: %v", err)
	}
	defer relayer.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		logger.Info("Received shutdown signal")
		cancel()
	}()

	if err := relayer.Start(ctx); err != nil {
		return fmt.Errorf("relayer stopped with error: %v", err)
	}

	return nil
}
