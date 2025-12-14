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

// EVMChainConfig holds chain-specific configuration
type EVMChainConfig struct {
	DestinationChainID uint16
	DefaultRPCURL      string
	DefaultSourceChains []int
	DisplayName        string
}

// Supported EVM chains
var EVMChainConfigs = map[string]EVMChainConfig{
	"arbitrum": {
		DestinationChainID:  10003,
		DefaultRPCURL:       "https://sepolia-rollup.arbitrum.io/rpc",
		DefaultSourceChains: []int{56, 1, 10004}, // Aztec, Solana, Base
		DisplayName:         "Arbitrum Sepolia",
	},
	"base": {
		DestinationChainID:  10004,
		DefaultRPCURL:       "https://sepolia.base.org",
		DefaultSourceChains: []int{56, 1, 10003}, // Aztec, Solana, Arbitrum
		DisplayName:         "Base Sepolia",
	},
}

// evmCmd represents the command to relay VAAs to EVM chains
var evmCmd = &cobra.Command{
	Use:   "evm",
	Short: "Relay Wormhole VAAs to EVM chains",
	Long: `Listens for Wormhole VAAs from configured source chains and relays them to EVM.

This command monitors the Wormhole network for messages from Aztec, Solana,
or other configured chains and submits them to the specified EVM chain.

Use --chain to specify the target chain (arbitrum or base).`,
	PreRun: func(cmd *cobra.Command, args []string) {
		printBanner()
		configureLogging(cmd, args)
	},
	RunE: runEVMRelay,
}

func init() {
	rootCmd.AddCommand(evmCmd)

	// Chain selection flag
	evmCmd.Flags().String(
		"chain",
		"arbitrum",
		"Target EVM chain (arbitrum, base)")

	// EVM-specific flags
	evmCmd.Flags().String(
		"evm-rpc-url",
		"",
		"RPC URL for EVM chain (defaults based on --chain)")

	evmCmd.Flags().String(
		"private-key",
		"",
		"Private key for EVM transactions (required)")

	evmCmd.Flags().String(
		"evm-target-contract",
		"",
		"Target contract on EVM chain to send VAAs to (required)")

	evmCmd.Flags().IntSlice(
		"chain-ids",
		nil,
		"Source chain IDs to listen for (defaults based on --chain)")

	evmCmd.Flags().String(
		"emitter-address",
		"",
		"Source emitter address to filter (hex, e.g., Aztec bridge address)")

	// Mark private key and target contract as required
	evmCmd.MarkFlagRequired("private-key")
	evmCmd.MarkFlagRequired("evm-target-contract")

	// Bind flags to viper
	viper.BindPFlag("chain", evmCmd.Flags().Lookup("chain"))
	viper.BindPFlag("evm_rpc_url", evmCmd.Flags().Lookup("evm-rpc-url"))
	viper.BindPFlag("private_key", evmCmd.Flags().Lookup("private-key"))
	viper.BindPFlag("evm_target_contract", evmCmd.Flags().Lookup("evm-target-contract"))
	viper.BindPFlag("chain_ids", evmCmd.Flags().Lookup("chain-ids"))
	viper.BindPFlag("emitter_address", evmCmd.Flags().Lookup("emitter-address"))
}

type EVMConfig struct {
	ChainName         string   // Target chain name (arbitrum, base)
	SpyRPCHost        string   // Wormhole spy service endpoint
	ChainIDs          []uint16 // Source chain IDs to listen for
	EVMRPCURL         string   // RPC URL for EVM chain
	PrivateKey        string   // Private key for EVM transactions
	EVMTargetContract string   // Target contract on EVM
	EmitterAddress    string   // Source emitter address to filter
}

func runEVMRelay(cmd *cobra.Command, args []string) error {
	logger := configureLogging(cmd, args)

	// Get chain selection
	chainName, _ := cmd.Flags().GetString("chain")
	chainConfig, ok := EVMChainConfigs[chainName]
	if !ok {
		return fmt.Errorf("unsupported chain: %s (valid: arbitrum, base)", chainName)
	}

	logger.Info(fmt.Sprintf("Starting %s relayer", chainConfig.DisplayName))

	// Get flags directly from command (viper bindings conflict across commands)
	emitterAddress, _ := cmd.Flags().GetString("emitter-address")
	chainIDsInt, _ := cmd.Flags().GetIntSlice("chain-ids")

	// Use default source chains if not specified
	if len(chainIDsInt) == 0 {
		chainIDsInt = chainConfig.DefaultSourceChains
	}

	// Convert chain IDs from []int to []uint16
	chainIDs := make([]uint16, len(chainIDsInt))
	for i, id := range chainIDsInt {
		chainIDs[i] = uint16(id)
	}

	// Get RPC URL, use default if not specified
	rpcURL := viper.GetString("evm_rpc_url")
	if rpcURL == "" {
		rpcURL = chainConfig.DefaultRPCURL
	}

	config := EVMConfig{
		ChainName:         chainName,
		SpyRPCHost:        viper.GetString("spy_rpc_host"),
		ChainIDs:          chainIDs,
		EVMRPCURL:         rpcURL,
		PrivateKey:        viper.GetString("private_key"),
		EVMTargetContract: viper.GetString("evm_target_contract"),
		EmitterAddress:    emitterAddress,
	}

	// Validate private key is provided
	if config.PrivateKey == "" {
		return fmt.Errorf("private key is required for EVM transactions")
	}

	logger.Info("Configuration",
		zap.String("chain", chainConfig.DisplayName),
		zap.Uint16("destinationChainID", chainConfig.DestinationChainID),
		zap.String("spyRPC", config.SpyRPCHost),
		zap.Any("sourceChainIds", config.ChainIDs),
		zap.String("evmRPC", config.EVMRPCURL),
		zap.String("evmTarget", config.EVMTargetContract),
		zap.String("emitterFilter", config.EmitterAddress))

	// Create spy client
	spyClient, err := clients.NewSpyClient(logger, config.SpyRPCHost)
	if err != nil {
		return fmt.Errorf("failed to create spy client: %v", err)
	}

	// Create EVM client
	evmClient, err := clients.NewEVMClient(logger, config.EVMRPCURL, config.PrivateKey)
	if err != nil {
		return fmt.Errorf("failed to create EVM client: %v", err)
	}

	logger.Info("Connected to EVM",
		zap.String("address", evmClient.GetAddress().Hex()))

	// Create EVM submitter
	evmSubmitter := submitter.NewEVMSubmitter(logger, config.EVMTargetContract, evmClient)

	// Create VAA processor
	vaaProcessor := internal.NewDefaultVAAProcessor(logger,
		internal.VAAProcessorConfig{
			ChainIDs:           config.ChainIDs,
			EmitterAddress:     config.EmitterAddress,
			DestinationChainID: chainConfig.DestinationChainID,
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
