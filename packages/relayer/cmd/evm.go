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
	// Default configuration values for EVM
	DefaultEVMRPCURL         = "https://sepolia-rollup.arbitrum.io/rpc"
	DefaultEVMTargetContract = "0x248EC2E5595480fF371031698ae3a4099b8dC229"

	// Wormhole chain ID for Arbitrum Sepolia
	EVMDestinationChainID uint16 = 10003
)

// Default source chains for EVM destination (Aztec=56, Solana=1)
var DefaultEVMSourceChains = []int{56, 1}

// evmCmd represents the command to relay VAAs to EVM chains
var evmCmd = &cobra.Command{
	Use:   "evm",
	Short: "Relay Wormhole VAAs to EVM chains",
	Long: `Listens for Wormhole VAAs from configured source chains and relays them to EVM.

This command monitors the Wormhole network for messages from Aztec, Solana,
or other configured chains and submits them to the specified EVM chain.`,
	PreRun: func(cmd *cobra.Command, args []string) {
		printBanner()
		configureLogging(cmd, args)
	},
	RunE: runEVMRelay,
}

func init() {
	rootCmd.AddCommand(evmCmd)

	// EVM-specific flags
	evmCmd.Flags().String(
		"evm-rpc-url",
		DefaultEVMRPCURL,
		"RPC URL for EVM chain (e.g., Arbitrum)")

	evmCmd.Flags().String(
		"private-key",
		"",
		"Private key for EVM transactions (required)")

	evmCmd.Flags().String(
		"evm-target-contract",
		DefaultEVMTargetContract,
		"Target contract on EVM chain to send VAAs to")

	evmCmd.Flags().IntSlice(
		"chain-ids",
		DefaultEVMSourceChains,
		"Source chain IDs to listen for (Aztec=56, Solana=1)")

	evmCmd.Flags().String(
		"emitter-address",
		"",
		"Source emitter address to filter (hex, e.g., Aztec bridge address)")

	// Mark private key as required
	evmCmd.MarkFlagRequired("private-key")

	// Bind flags to viper
	viper.BindPFlag("evm_rpc_url", evmCmd.Flags().Lookup("evm-rpc-url"))
	viper.BindPFlag("private_key", evmCmd.Flags().Lookup("private-key"))
	viper.BindPFlag("evm_target_contract", evmCmd.Flags().Lookup("evm-target-contract"))
	viper.BindPFlag("chain_ids", evmCmd.Flags().Lookup("chain-ids"))
	viper.BindPFlag("emitter_address", evmCmd.Flags().Lookup("emitter-address"))
}

type EVMConfig struct {
	SpyRPCHost        string   // Wormhole spy service endpoint
	ChainIDs          []uint16 // Source chain IDs to listen for
	EVMRPCURL         string   // RPC URL for EVM chain
	PrivateKey        string   // Private key for EVM transactions
	EVMTargetContract string   // Target contract on EVM
	EmitterAddress    string   // Source emitter address to filter
}

func runEVMRelay(cmd *cobra.Command, args []string) error {
	logger := configureLogging(cmd, args)
	logger.Info("Starting EVM relayer")

	// Get flags directly from command (viper bindings conflict across commands)
	emitterAddress, _ := cmd.Flags().GetString("emitter-address")
	chainIDsInt, _ := cmd.Flags().GetIntSlice("chain-ids")

	// Convert chain IDs from []int to []uint16
	chainIDs := make([]uint16, len(chainIDsInt))
	for i, id := range chainIDsInt {
		chainIDs[i] = uint16(id)
	}

	config := EVMConfig{
		SpyRPCHost:        viper.GetString("spy_rpc_host"),
		ChainIDs:          chainIDs,
		EVMRPCURL:         viper.GetString("evm_rpc_url"),
		PrivateKey:        viper.GetString("private_key"),
		EVMTargetContract: viper.GetString("evm_target_contract"),
		EmitterAddress:    emitterAddress,
	}

	// Validate private key is provided
	if config.PrivateKey == "" {
		return fmt.Errorf("private key is required for EVM transactions")
	}

	logger.Info("Configuration",
		zap.String("spyRPC", config.SpyRPCHost),
		zap.Any("chainIds", config.ChainIDs),
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
			DestinationChainID: EVMDestinationChainID,
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