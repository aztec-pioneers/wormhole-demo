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
	// Default configuration values for Base Sepolia
	DefaultBaseRPCURL         = "https://sepolia.base.org"
	DefaultBaseTargetContract = ""

	// Wormhole chain ID for Base Sepolia
	BaseDestinationChainID uint16 = 10004
)

// Default source chains for Base destination (Aztec=56, Solana=1, Arbitrum=10003)
var DefaultBaseSourceChains = []int{56, 1, 10003}

// baseCmd represents the command to relay VAAs to Base Sepolia
var baseCmd = &cobra.Command{
	Use:   "base",
	Short: "Relay Wormhole VAAs to Base Sepolia",
	Long: `Listens for Wormhole VAAs from configured source chains and relays them to Base Sepolia.

This command monitors the Wormhole network for messages from Aztec, Solana, Arbitrum,
or other configured chains and submits them to the specified Base Sepolia chain.`,
	PreRun: func(cmd *cobra.Command, args []string) {
		printBanner()
		configureLogging(cmd, args)
	},
	RunE: runBaseRelay,
}

func init() {
	rootCmd.AddCommand(baseCmd)

	// Base-specific flags
	baseCmd.Flags().String(
		"base-rpc-url",
		DefaultBaseRPCURL,
		"RPC URL for Base Sepolia chain")

	baseCmd.Flags().String(
		"private-key",
		"",
		"Private key for Base transactions (required)")

	baseCmd.Flags().String(
		"base-target-contract",
		DefaultBaseTargetContract,
		"Target contract on Base Sepolia to send VAAs to")

	baseCmd.Flags().IntSlice(
		"chain-ids",
		DefaultBaseSourceChains,
		"Source chain IDs to listen for (Aztec=56, Solana=1, Arbitrum=10003)")

	baseCmd.Flags().String(
		"emitter-address",
		"",
		"Source emitter address to filter (hex)")

	// Mark private key as required
	baseCmd.MarkFlagRequired("private-key")

	// Bind flags to viper
	viper.BindPFlag("base_rpc_url", baseCmd.Flags().Lookup("base-rpc-url"))
	viper.BindPFlag("private_key", baseCmd.Flags().Lookup("private-key"))
	viper.BindPFlag("base_target_contract", baseCmd.Flags().Lookup("base-target-contract"))
	viper.BindPFlag("chain_ids", baseCmd.Flags().Lookup("chain-ids"))
	viper.BindPFlag("emitter_address", baseCmd.Flags().Lookup("emitter-address"))
}

type BaseConfig struct {
	SpyRPCHost         string   // Wormhole spy service endpoint
	ChainIDs           []uint16 // Source chain IDs to listen for
	BaseRPCURL         string   // RPC URL for Base Sepolia
	PrivateKey         string   // Private key for Base transactions
	BaseTargetContract string   // Target contract on Base Sepolia
	EmitterAddress     string   // Source emitter address to filter
}

func runBaseRelay(cmd *cobra.Command, args []string) error {
	logger := configureLogging(cmd, args)
	logger.Info("Starting Base Sepolia relayer")

	// Get flags directly from command (viper bindings conflict across commands)
	emitterAddress, _ := cmd.Flags().GetString("emitter-address")
	chainIDsInt, _ := cmd.Flags().GetIntSlice("chain-ids")

	// Convert chain IDs from []int to []uint16
	chainIDs := make([]uint16, len(chainIDsInt))
	for i, id := range chainIDsInt {
		chainIDs[i] = uint16(id)
	}

	config := BaseConfig{
		SpyRPCHost:         viper.GetString("spy_rpc_host"),
		ChainIDs:           chainIDs,
		BaseRPCURL:         viper.GetString("base_rpc_url"),
		PrivateKey:         viper.GetString("private_key"),
		BaseTargetContract: viper.GetString("base_target_contract"),
		EmitterAddress:     emitterAddress,
	}

	// Validate private key is provided
	if config.PrivateKey == "" {
		return fmt.Errorf("private key is required for Base transactions")
	}

	logger.Info("Configuration",
		zap.String("spyRPC", config.SpyRPCHost),
		zap.Any("chainIds", config.ChainIDs),
		zap.String("baseRPC", config.BaseRPCURL),
		zap.String("baseTarget", config.BaseTargetContract),
		zap.String("emitterFilter", config.EmitterAddress))

	// Create spy client
	spyClient, err := clients.NewSpyClient(logger, config.SpyRPCHost)
	if err != nil {
		return fmt.Errorf("failed to create spy client: %v", err)
	}

	// Create EVM client (Base uses the same EVM client as Arbitrum)
	evmClient, err := clients.NewEVMClient(logger, config.BaseRPCURL, config.PrivateKey)
	if err != nil {
		return fmt.Errorf("failed to create EVM client: %v", err)
	}

	logger.Info("Connected to Base Sepolia",
		zap.String("address", evmClient.GetAddress().Hex()))

	// Create EVM submitter
	evmSubmitter := submitter.NewEVMSubmitter(logger, config.BaseTargetContract, evmClient)

	// Create VAA processor
	vaaProcessor := internal.NewDefaultVAAProcessor(logger,
		internal.VAAProcessorConfig{
			ChainIDs:           config.ChainIDs,
			EmitterAddress:     config.EmitterAddress,
			DestinationChainID: BaseDestinationChainID,
		},
		evmSubmitter)

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
