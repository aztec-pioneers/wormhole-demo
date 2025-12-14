package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"

	"github.com/wormhole-demo/relayer/internal"
	"github.com/wormhole-demo/relayer/internal/clients"
	"github.com/wormhole-demo/relayer/internal/submitter"
)

const (
	// Default configuration values for Solana
	DefaultSolanaRPCURL = "https://api.devnet.solana.com"

	// Wormhole chain ID for Solana
	SolanaDestinationChainID uint16 = 1
)

// Default source chains for Solana destination (Arbitrum=10003, Aztec=56, Base=10004)
var DefaultSolanaSourceChains = []int{10003, 56, 10004}

// solanaCmd represents the command to relay VAAs to Solana
var solanaCmd = &cobra.Command{
	Use:   "solana",
	Short: "Relay Wormhole VAAs to Solana",
	Long: `Listens for Wormhole VAAs from configured source chains and relays them to Solana.

This command monitors the Wormhole network for messages from EVM chains, Aztec,
or other configured chains and submits them to the Solana MessageBridge program.`,
	PreRun: func(cmd *cobra.Command, args []string) {
		printBanner()
		configureLogging(cmd, args)
	},
	RunE: runSolanaRelay,
}

func init() {
	rootCmd.AddCommand(solanaCmd)

	// Solana-specific flags
	solanaCmd.Flags().String(
		"solana-rpc-url",
		DefaultSolanaRPCURL,
		"RPC URL for Solana (devnet)")

	solanaCmd.Flags().String(
		"solana-private-key",
		"",
		"Private key for Solana transactions (base58 encoded, required)")

	solanaCmd.Flags().String(
		"solana-program-id",
		"",
		"MessageBridge program ID on Solana (required)")

	solanaCmd.Flags().String(
		"solana-wormhole-program-id",
		"",
		"Wormhole Core Bridge program ID on Solana (default: devnet)")

	solanaCmd.Flags().IntSlice(
		"chain-ids",
		DefaultSolanaSourceChains,
		"Source chain IDs to listen for (Arbitrum=10003, Aztec=56, Base=10004)")

	solanaCmd.Flags().String(
		"emitter-address",
		"",
		"Source emitter address to filter (hex)")

	// Mark required flags
	solanaCmd.MarkFlagRequired("solana-private-key")
	solanaCmd.MarkFlagRequired("solana-program-id")

	// Bind flags to viper (but chain_ids read from flags directly to avoid conflicts)
	viper.BindPFlag("solana_rpc_url", solanaCmd.Flags().Lookup("solana-rpc-url"))
	viper.BindPFlag("solana_private_key", solanaCmd.Flags().Lookup("solana-private-key"))
	viper.BindPFlag("solana_program_id", solanaCmd.Flags().Lookup("solana-program-id"))
	viper.BindPFlag("solana_wormhole_program_id", solanaCmd.Flags().Lookup("solana-wormhole-program-id"))
	viper.BindPFlag("emitter_address", solanaCmd.Flags().Lookup("emitter-address"))
	// Note: solana_vaa_service_url is read from env WORMHOLE_RELAYER_SOLANA_VAA_SERVICE_URL
}

type SolanaConfig struct {
	SpyRPCHost              string   // Wormhole spy service endpoint
	ChainIDs                []uint16 // Source chain IDs to listen for
	SolanaRPCURL            string   // RPC URL for Solana
	SolanaPrivateKey        string   // Private key for Solana transactions (base58)
	SolanaProgramID         string   // MessageBridge program ID
	SolanaWormholeProgramID string   // Wormhole Core Bridge program ID (optional, defaults to devnet)
	SolanaVAAServiceURL     string   // URL for the Solana VAA posting service
	EmitterAddress          string   // Source emitter address to filter
}

func runSolanaRelay(cmd *cobra.Command, args []string) error {
	logger := configureLogging(cmd, args)
	logger.Info("Starting Solana relayer")

	// Get flags directly from command (viper bindings conflict across commands)
	emitterAddress, _ := cmd.Flags().GetString("emitter-address")
	chainIDsInt, _ := cmd.Flags().GetIntSlice("chain-ids")

	// Convert chain IDs from []int to []uint16
	chainIDs := make([]uint16, len(chainIDsInt))
	for i, id := range chainIDsInt {
		chainIDs[i] = uint16(id)
	}

	config := SolanaConfig{
		SpyRPCHost:              viper.GetString("spy_rpc_host"),
		ChainIDs:                chainIDs,
		SolanaRPCURL:            viper.GetString("solana_rpc_url"),
		SolanaPrivateKey:        viper.GetString("solana_private_key"),
		SolanaProgramID:         viper.GetString("solana_program_id"),
		SolanaWormholeProgramID: viper.GetString("solana_wormhole_program_id"),
		SolanaVAAServiceURL:     viper.GetString("solana_vaa_service_url"),
		EmitterAddress:          emitterAddress,
	}

	// Validate required config
	if config.SolanaPrivateKey == "" {
		return fmt.Errorf("Solana private key is required")
	}
	if config.SolanaProgramID == "" {
		return fmt.Errorf("Solana program ID is required")
	}

	logger.Info("Configuration",
		zap.String("spyRPC", config.SpyRPCHost),
		zap.Any("chainIds", config.ChainIDs),
		zap.String("solanaRPC", config.SolanaRPCURL),
		zap.String("solanaProgramID", config.SolanaProgramID),
		zap.String("vaaServiceURL", config.SolanaVAAServiceURL),
		zap.String("emitterFilter", config.EmitterAddress))

	// Create spy client
	spyClient, err := clients.NewSpyClient(logger, config.SpyRPCHost)
	if err != nil {
		return fmt.Errorf("failed to create spy client: %v", err)
	}

	// Create Solana client
	solanaClient, err := clients.NewSolanaClient(
		logger,
		config.SolanaRPCURL,
		config.SolanaPrivateKey,
		config.SolanaProgramID,
		config.SolanaWormholeProgramID,
		config.SolanaVAAServiceURL,
	)
	if err != nil {
		return fmt.Errorf("failed to create Solana client: %v", err)
	}

	logger.Info("Connected to Solana",
		zap.String("payer", solanaClient.GetPayerAddress().String()),
		zap.String("programID", solanaClient.GetProgramID().String()))

	// Create Solana submitter
	solanaSubmitter := submitter.NewSolanaSubmitter(logger, solanaClient)

	// Create VAA processor
	vaaProcessor := internal.NewDefaultVAAProcessor(logger,
		internal.VAAProcessorConfig{
			ChainIDs:           config.ChainIDs,
			EmitterAddress:     config.EmitterAddress,
			DestinationChainID: SolanaDestinationChainID,
		},
		solanaSubmitter)

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
