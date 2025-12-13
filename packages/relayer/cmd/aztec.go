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
	// Default configuration values
	DefaultAztecPXEURL            = "http://localhost:8090"
	DefaultAztecWalletAddress     = "0x1f3933ca4d66e948ace5f8339e5da687993b76ee57bcf65e82596e0fc10a8859"
	DefaultAztecTargetContract    = "0x0848d2af89dfd7c0e171238f9216399e61e908cd31b0222a920f1bf621a16ed6"
	DefaultVerificationServiceURL = "http://localhost:8080"

	// Wormhole chain ID for Aztec
	AztecDestinationChainID uint16 = 56
)

// Default source chains for Aztec destination (Arbitrum=10003, Solana=1)
var DefaultAztecSourceChains = []int{10003, 1}

// aztecCmd represents the command to relay VAAs to Aztec
var aztecCmd = &cobra.Command{
	Use:   "aztec",
	Short: "Relay Wormhole VAAs to Aztec",
	Long: `Listens for Wormhole VAAs from configured source chains and relays them to Aztec.

This command monitors the Wormhole network for messages from EVM chains, Solana,
or other configured chains and submits them to the Aztec network.`,
	PreRun: func(cmd *cobra.Command, args []string) {
		printBanner()
		configureLogging(cmd, args)
	},
	RunE: runAztecRelay,
}

func init() {
	rootCmd.AddCommand(aztecCmd)

	// Aztec-specific flags
	aztecCmd.Flags().String(
		"aztec-pxe-url",
		DefaultAztecPXEURL,
		"PXE URL for Aztec")

	aztecCmd.Flags().String(
		"aztec-wallet-address",
		DefaultAztecWalletAddress,
		"Aztec wallet address to use")

	aztecCmd.Flags().String(
		"aztec-target-contract",
		DefaultAztecTargetContract,
		"Target contract on Aztec to send VAAs to")

	aztecCmd.Flags().String(
		"verification-service-url",
		DefaultVerificationServiceURL,
		"Verification service URL (optional)")

	aztecCmd.Flags().IntSlice(
		"chain-ids",
		DefaultAztecSourceChains,
		"Source chain IDs to listen for (Arbitrum=10003, Solana=1)")

	aztecCmd.Flags().String(
		"emitter-address",
		"",
		"Source emitter address to filter (hex, e.g., EVM bridge address)")

	// Bind flags to viper
	viper.BindPFlag("aztec_pxe_url", aztecCmd.Flags().Lookup("aztec-pxe-url"))
	viper.BindPFlag("aztec_wallet_address", aztecCmd.Flags().Lookup("aztec-wallet-address"))
	viper.BindPFlag("aztec_target_contract", aztecCmd.Flags().Lookup("aztec-target-contract"))
	viper.BindPFlag("verification_service_url", aztecCmd.Flags().Lookup("verification-service-url"))
	viper.BindPFlag("chain_ids", aztecCmd.Flags().Lookup("chain-ids"))
	viper.BindPFlag("emitter_address", aztecCmd.Flags().Lookup("emitter-address"))
}

type AztecConfig struct {
	SpyRPCHost             string   // Wormhole spy service endpoint
	ChainIDs               []uint16 // Source chain IDs to listen for
	AztecPXEURL            string   // PXE URL for Aztec
	AztecWalletAddress     string   // Aztec wallet address to use
	AztecTargetContract    string   // Target contract on Aztec
	VerificationServiceURL string   // Optional verification service URL
	EmitterAddress         string   // Source emitter address to filter
}

func runAztecRelay(cmd *cobra.Command, args []string) error {
	logger := configureLogging(cmd, args)
	logger.Info("Starting Aztec relayer")

	// Get flags directly from command (viper bindings conflict across commands)
	emitterAddress, _ := cmd.Flags().GetString("emitter-address")
	chainIDsInt, _ := cmd.Flags().GetIntSlice("chain-ids")

	// Convert chain IDs from []int to []uint16
	chainIDs := make([]uint16, len(chainIDsInt))
	for i, id := range chainIDsInt {
		chainIDs[i] = uint16(id)
	}

	config := AztecConfig{
		SpyRPCHost:             viper.GetString("spy_rpc_host"),
		ChainIDs:               chainIDs,
		AztecPXEURL:            viper.GetString("aztec_pxe_url"),
		AztecWalletAddress:     viper.GetString("aztec_wallet_address"),
		AztecTargetContract:    viper.GetString("aztec_target_contract"),
		VerificationServiceURL: viper.GetString("verification_service_url"),
		EmitterAddress:         emitterAddress,
	}

	logger.Info("Configuration",
		zap.String("spyRPC", config.SpyRPCHost),
		zap.Any("chainIds", config.ChainIDs),
		zap.String("aztecPXE", config.AztecPXEURL),
		zap.String("aztecWallet", config.AztecWalletAddress),
		zap.String("aztecTarget", config.AztecTargetContract),
		zap.String("verificationService", config.VerificationServiceURL),
		zap.String("emitterFilter", config.EmitterAddress))

	spyClient, err := clients.NewSpyClient(logger, config.SpyRPCHost)
	if err != nil {
		return fmt.Errorf("failed to create spy client: %v", err)
	}

	// Check verification service health first
	verificationService := clients.NewVerificationServiceClient(logger, config.VerificationServiceURL)
	healthCtx, healthCancel := context.WithTimeout(context.Background(), 10*time.Second)
	verificationHealthy := false
	if err := verificationService.CheckHealth(healthCtx); err != nil {
		logger.Warn("Verification service not available", zap.Error(err))
	} else {
		logger.Info("Connected to verification service", zap.String("url", config.VerificationServiceURL))
		verificationHealthy = true
	}
	healthCancel()

	// PXE client is optional if verification service is healthy, required otherwise
	var pxeClient *clients.AztecPXEClient
	pxeClient, err = clients.NewAztecPXEClient(
		logger, config.AztecPXEURL, config.AztecWalletAddress)
	if err != nil {
		if verificationHealthy {
			logger.Warn("PXE client not available, using verification service only", zap.Error(err))
			pxeClient = nil
		} else {
			return fmt.Errorf("failed to create PXE client and verification service is not healthy: %v", err)
		}
	}

	aztecSubmitter := submitter.NewAztecSubmitter(logger,
		config.AztecTargetContract, pxeClient, verificationService)
	vaaProcessor := internal.NewDefaultVAAProcessor(logger,
		internal.VAAProcessorConfig{
			ChainIDs:           config.ChainIDs,
			EmitterAddress:     config.EmitterAddress,
			DestinationChainID: AztecDestinationChainID,
		},
		aztecSubmitter)

	// Create and start relayer
	relayer, err := internal.NewRelayer(logger, spyClient, vaaProcessor)
	if err != nil {
		return fmt.Errorf("failed to initialize relayer: %v", err)
	}
	defer relayer.Close()

	// Setup context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle graceful shutdown
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		logger.Info("Received shutdown signal")
		cancel()
	}()

	// Start the relayer
	if err := relayer.Start(ctx); err != nil {
		return fmt.Errorf("relayer stopped with error: %v", err)
	}

	return nil
}
