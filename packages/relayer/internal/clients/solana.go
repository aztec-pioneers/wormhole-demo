package clients

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"go.uber.org/zap"
)

// Default Wormhole devnet program ID
var DefaultWormholeProgramID = solana.MustPublicKeyFromBase58("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5")

// PDA seeds for our MessageBridge program
var (
	SeedConfig       = []byte("config")
	SeedCurrentValue = []byte("current_value")
	SeedEmitter      = []byte("emitter")
	SeedForeignEmitter = []byte("foreign_emitter")
	SeedReceived     = []byte("received")
)

// Wormhole PDA seeds
var (
	SeedPostedVAA = []byte("PostedVAA")
)

// Instruction discriminators (from Anchor IDL)
var DiscriminatorReceiveValue = []byte{131, 101, 246, 45, 2, 139, 81, 21}

// SolanaClient handles interactions with Solana blockchain
type SolanaClient struct {
	client            *rpc.Client
	payer             solana.PrivateKey
	programID         solana.PublicKey
	wormholeProgramID solana.PublicKey
	vaaServiceURL     string // URL of the VAA posting service
	httpClient        *http.Client
	logger            *zap.Logger
}

// NewSolanaClient creates a new Solana client
// If wormholeProgramID is empty, uses DefaultWormholeProgramID (devnet)
// If vaaServiceURL is provided, VAAs will be posted via that service before calling receive_value
func NewSolanaClient(logger *zap.Logger, rpcURL string, privateKeyBase58 string, programID string, wormholeProgramID string, vaaServiceURL string) (*SolanaClient, error) {
	client := &SolanaClient{
		logger:        logger.With(zap.String("component", "SolanaClient")),
		vaaServiceURL: vaaServiceURL,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}

	client.logger.Info("Connecting to Solana", zap.String("rpcURL", rpcURL))

	// Create RPC client
	rpcClient := rpc.New(rpcURL)
	client.client = rpcClient

	// Parse private key from base58
	privKey, err := solana.PrivateKeyFromBase58(privateKeyBase58)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %v", err)
	}
	client.payer = privKey

	// Parse program ID
	progID, err := solana.PublicKeyFromBase58(programID)
	if err != nil {
		return nil, fmt.Errorf("invalid program ID: %v", err)
	}
	client.programID = progID

	// Parse Wormhole program ID or use default
	if wormholeProgramID != "" {
		whProgID, err := solana.PublicKeyFromBase58(wormholeProgramID)
		if err != nil {
			return nil, fmt.Errorf("invalid wormhole program ID: %v", err)
		}
		client.wormholeProgramID = whProgID
	} else {
		client.wormholeProgramID = DefaultWormholeProgramID
	}

	client.logger.Info("Solana client initialized",
		zap.String("payer", client.payer.PublicKey().String()),
		zap.String("programID", client.programID.String()),
		zap.String("wormholeProgramID", client.wormholeProgramID.String()),
		zap.String("vaaServiceURL", client.vaaServiceURL))

	return client, nil
}

// GetPayerAddress returns the payer's public key
func (c *SolanaClient) GetPayerAddress() solana.PublicKey {
	return c.payer.PublicKey()
}

// GetProgramID returns the MessageBridge program ID
func (c *SolanaClient) GetProgramID() solana.PublicKey {
	return c.programID
}

// DeriveConfigPDA derives the config PDA
func (c *SolanaClient) DeriveConfigPDA() (solana.PublicKey, uint8, error) {
	return solana.FindProgramAddress([][]byte{SeedConfig}, c.programID)
}

// DeriveCurrentValuePDA derives the current value PDA
func (c *SolanaClient) DeriveCurrentValuePDA() (solana.PublicKey, uint8, error) {
	return solana.FindProgramAddress([][]byte{SeedCurrentValue}, c.programID)
}

// DeriveForeignEmitterPDA derives the foreign emitter PDA for a chain
func (c *SolanaClient) DeriveForeignEmitterPDA(chainID uint16) (solana.PublicKey, uint8, error) {
	chainIDBytes := make([]byte, 2)
	binary.LittleEndian.PutUint16(chainIDBytes, chainID)
	return solana.FindProgramAddress([][]byte{SeedForeignEmitter, chainIDBytes}, c.programID)
}

// DeriveReceivedMessagePDA derives the received message PDA for replay protection
func (c *SolanaClient) DeriveReceivedMessagePDA(emitterChain uint16, sequence uint64) (solana.PublicKey, uint8, error) {
	chainIDBytes := make([]byte, 2)
	binary.LittleEndian.PutUint16(chainIDBytes, emitterChain)
	sequenceBytes := make([]byte, 8)
	binary.LittleEndian.PutUint64(sequenceBytes, sequence)
	return solana.FindProgramAddress([][]byte{SeedReceived, chainIDBytes, sequenceBytes}, c.programID)
}

// DerivePostedVAAPDA derives the posted VAA PDA from VAA hash
func (c *SolanaClient) DerivePostedVAAPDA(vaaHash [32]byte) (solana.PublicKey, uint8, error) {
	return solana.FindProgramAddress([][]byte{SeedPostedVAA, vaaHash[:]}, c.wormholeProgramID)
}

// ComputeVAAHash computes the hash of VAA body (used for posted VAA PDA)
// Wormhole uses keccak256 of the VAA body for PDA derivation
func ComputeVAAHash(vaaBytes []byte) ([32]byte, error) {
	// VAA structure:
	// - 1 byte: version
	// - 4 bytes: guardian set index
	// - 1 byte: signature count
	// - 66 bytes per signature (guardian index + r + s + v)
	// - body starts after signatures

	if len(vaaBytes) < 6 {
		return [32]byte{}, fmt.Errorf("VAA too short")
	}

	sigCount := int(vaaBytes[5])
	bodyStart := 6 + (sigCount * 66)

	if len(vaaBytes) < bodyStart {
		return [32]byte{}, fmt.Errorf("VAA too short for %d signatures", sigCount)
	}

	body := vaaBytes[bodyStart:]
	// Wormhole uses keccak256 for VAA body hash (same as Ethereum)
	hash := crypto.Keccak256Hash(body)
	return hash, nil
}

// BuildReceiveValueInstruction builds the receive_value instruction
func (c *SolanaClient) BuildReceiveValueInstruction(
	vaaHash [32]byte,
	emitterChain uint16,
	sequence uint64,
	postedVAA solana.PublicKey,
) (*solana.GenericInstruction, error) {
	// Derive PDAs
	configPDA, _, err := c.DeriveConfigPDA()
	if err != nil {
		return nil, fmt.Errorf("failed to derive config PDA: %v", err)
	}

	currentValuePDA, _, err := c.DeriveCurrentValuePDA()
	if err != nil {
		return nil, fmt.Errorf("failed to derive current value PDA: %v", err)
	}

	foreignEmitterPDA, _, err := c.DeriveForeignEmitterPDA(emitterChain)
	if err != nil {
		return nil, fmt.Errorf("failed to derive foreign emitter PDA: %v", err)
	}

	receivedMessagePDA, _, err := c.DeriveReceivedMessagePDA(emitterChain, sequence)
	if err != nil {
		return nil, fmt.Errorf("failed to derive received message PDA: %v", err)
	}

	// Build instruction data: discriminator + vaa_hash (32 bytes) + emitter_chain (u16) + sequence (u64)
	data := make([]byte, 8+32+2+8)
	copy(data[0:8], DiscriminatorReceiveValue)
	copy(data[8:40], vaaHash[:])
	binary.LittleEndian.PutUint16(data[40:42], emitterChain)
	binary.LittleEndian.PutUint64(data[42:50], sequence)

	// Build accounts list
	accounts := []*solana.AccountMeta{
		{PublicKey: c.payer.PublicKey(), IsSigner: true, IsWritable: true},   // payer
		{PublicKey: configPDA, IsSigner: false, IsWritable: false},           // config
		{PublicKey: currentValuePDA, IsSigner: false, IsWritable: true},      // current_value
		{PublicKey: c.wormholeProgramID, IsSigner: false, IsWritable: false}, // wormhole_program
		{PublicKey: postedVAA, IsSigner: false, IsWritable: false},           // posted_vaa
		{PublicKey: foreignEmitterPDA, IsSigner: false, IsWritable: false},   // foreign_emitter
		{PublicKey: receivedMessagePDA, IsSigner: false, IsWritable: true},   // received_message
		{PublicKey: solana.SystemProgramID, IsSigner: false, IsWritable: false}, // system_program
	}

	instruction := solana.NewInstruction(
		c.programID,
		accounts,
		data,
	)

	return instruction, nil
}

// SendReceiveValueTransaction sends a receive_value transaction
func (c *SolanaClient) SendReceiveValueTransaction(
	ctx context.Context,
	vaaBytes []byte,
	emitterChain uint16,
	sequence uint64,
) (string, error) {
	c.logger.Debug("Building receive_value transaction",
		zap.Uint16("emitterChain", emitterChain),
		zap.Uint64("sequence", sequence),
		zap.Int("vaaLength", len(vaaBytes)))

	// Compute VAA hash
	vaaHash, err := ComputeVAAHash(vaaBytes)
	if err != nil {
		return "", fmt.Errorf("failed to compute VAA hash: %v", err)
	}

	// Derive posted VAA PDA
	postedVAA, _, err := c.DerivePostedVAAPDA(vaaHash)
	if err != nil {
		return "", fmt.Errorf("failed to derive posted VAA PDA: %v", err)
	}

	c.logger.Debug("Derived PDAs",
		zap.String("postedVAA", postedVAA.String()),
		zap.String("vaaHash", fmt.Sprintf("%x", vaaHash)))

	// Check if VAA is already posted
	postedVAAInfo, err := c.client.GetAccountInfo(ctx, postedVAA)
	if err != nil {
		c.logger.Warn("Could not check posted VAA account", zap.Error(err))
	}
	if postedVAAInfo == nil || postedVAAInfo.Value == nil {
		return "", fmt.Errorf("VAA not yet posted to Wormhole. PostedVAA account %s does not exist. Please ensure the VAA is posted via Wormhole first", postedVAA.String())
	}

	// Build receive_value instruction
	ix, err := c.BuildReceiveValueInstruction(vaaHash, emitterChain, sequence, postedVAA)
	if err != nil {
		return "", fmt.Errorf("failed to build instruction: %v", err)
	}

	// Get recent blockhash
	recentBlockhash, err := c.client.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
	if err != nil {
		return "", fmt.Errorf("failed to get recent blockhash: %v", err)
	}

	// Build transaction
	tx, err := solana.NewTransaction(
		[]solana.Instruction{ix},
		recentBlockhash.Value.Blockhash,
		solana.TransactionPayer(c.payer.PublicKey()),
	)
	if err != nil {
		return "", fmt.Errorf("failed to create transaction: %v", err)
	}

	// Sign transaction
	_, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
		if key.Equals(c.payer.PublicKey()) {
			return &c.payer
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("failed to sign transaction: %v", err)
	}

	// Send transaction
	sig, err := c.client.SendTransaction(ctx, tx)
	if err != nil {
		return "", fmt.Errorf("failed to send transaction: %v", err)
	}

	c.logger.Info("Transaction sent", zap.String("signature", sig.String()))

	return sig.String(), nil
}

// PostVAAToWormhole posts a VAA to the Wormhole bridge for verification.
// If vaaServiceURL is configured, it calls the external VAA posting service.
// Otherwise, it just checks if the VAA is already posted.
func (c *SolanaClient) PostVAAToWormhole(ctx context.Context, vaaBytes []byte) (solana.PublicKey, error) {
	vaaHash, err := ComputeVAAHash(vaaBytes)
	if err != nil {
		return solana.PublicKey{}, fmt.Errorf("failed to compute VAA hash: %v", err)
	}

	postedVAA, _, err := c.DerivePostedVAAPDA(vaaHash)
	if err != nil {
		return solana.PublicKey{}, fmt.Errorf("failed to derive posted VAA PDA: %v", err)
	}

	// Check if VAA is already posted
	info, err := c.client.GetAccountInfo(ctx, postedVAA)
	if err != nil {
		c.logger.Warn("Failed to check posted VAA account", zap.Error(err))
	}

	if info != nil && info.Value != nil {
		c.logger.Info("VAA already posted to Wormhole", zap.String("postedVAA", postedVAA.String()))
		return postedVAA, nil
	}

	// VAA not posted - try to post it via the VAA service
	if c.vaaServiceURL == "" {
		return solana.PublicKey{}, fmt.Errorf("VAA not yet posted to Wormhole at %s and no VAA service URL configured", postedVAA.String())
	}

	c.logger.Info("Posting VAA via VAA service",
		zap.String("serviceURL", c.vaaServiceURL),
		zap.Int("vaaLength", len(vaaBytes)))

	// Call the VAA posting service
	if err := c.callVAAService(ctx, vaaBytes); err != nil {
		return solana.PublicKey{}, fmt.Errorf("failed to post VAA via service: %w", err)
	}

	// Verify the VAA is now posted
	for i := 0; i < 10; i++ {
		time.Sleep(2 * time.Second)
		info, err = c.client.GetAccountInfo(ctx, postedVAA)
		if err == nil && info != nil && info.Value != nil {
			c.logger.Info("VAA successfully posted to Wormhole", zap.String("postedVAA", postedVAA.String()))
			return postedVAA, nil
		}
		c.logger.Debug("Waiting for VAA to be posted...", zap.Int("attempt", i+1))
	}

	return solana.PublicKey{}, fmt.Errorf("VAA was posted but not found on chain after 20 seconds")
}

// callVAAService posts a VAA to the external VAA posting service
func (c *SolanaClient) callVAAService(ctx context.Context, vaaBytes []byte) error {
	// Prepare request body
	reqBody := map[string]string{
		"vaa": hex.EncodeToString(vaaBytes),
	}
	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create HTTP request
	url := c.vaaServiceURL + "/post-vaa"
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqJSON))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	// Send request
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	// Parse response
	var result struct {
		Success   bool   `json:"success"`
		Signature string `json:"signature"`
		Error     string `json:"error"`
		Message   string `json:"message"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("failed to parse response: %w (body: %s)", err, string(body))
	}

	if !result.Success && result.Error != "" {
		return fmt.Errorf("VAA service error: %s", result.Error)
	}

	c.logger.Info("VAA posted via service",
		zap.String("signature", result.Signature),
		zap.String("message", result.Message))

	return nil
}
