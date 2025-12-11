import "dotenv/config";
import express from 'express';
import WormholeVaaService from './wormhole.js';


const PORT = process.env.PORT || 3000;

// DEVNET CONFIGURATION
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL;
const AZTEC_WORMHOLE_ADDRESS = process.env.AZTEC_WORMHOLE_ADDRESS;


let vaaService: WormholeVaaService;

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: isReady() ? 'healthy' : 'initializing',
    network: 'devnet',
    timestamp: new Date().toISOString(),
    nodeUrl: AZTEC_NODE_URL,
    contractAddress: AZTEC_WORMHOLE_ADDRESS,
    walletAddress: isReady() ? vaaService.getRelayerAddress().toString() : "not_initialized",
  });
});

// Verify VAA
app.post('/verify', async (req, res) => {
  if (!isReady()) {
    return res.status(503).json({
      success: false,
      error: 'Service not ready - Aztec devnet connection still initializing'
    });
  }

  try {
    const { vaaBytes } = req.body;

    if (!vaaBytes) {
      return res.status(400).json({
        success: false,
        error: 'vaaBytes is required'
      });
    }

    const result = await vaaService.verifyVaaBytes(vaaBytes, { includeDebug: true, debugLabel: 'Verify endpoint' });

    res.json({
      success: true,
      network: 'devnet',
      txHash: result.txHash,
      message: 'VAA verified successfully on Aztec devnet',
      processedAt: new Date().toISOString(),
      vaaLength: result.vaaLength,
    });

  } catch (error: any) {
    console.error('❌ VAA verification failed on DEVNET:', error.message);
    res.status(500).json({
      success: false,
      network: 'devnet',
      error: error.message,
      processedAt: new Date().toISOString()
    });
  }
});

// Test endpoint with a real Arbitrum Sepolia VAA
app.post('/test', async (req, res) => {
  // A real VAA from Arbitrum Sepolia that uses Guardian 0x13947Bd48b18E53fdAeEe77F3473391aC727C638
  // This VAA contains "Hello Wormhole!" message and has been verified on Wormholescan
  // Link: https://wormholescan.io/#/tx/0xf93fd41efeb09ff28174824d4abf6dbc06ac408953a9975aa4a403d434051efc?network=Testnet&view=advanced
  const realVAA = "010000000001004682bc4d5ff2e54dc2ee5e0eb64f5c6c07aa449ac539abc63c2be5c306a48f233e9300170a82adf3c3b7f43f23176fb079174a58d67d142477f646675d86eb6301684bfad4499602d22713000000000000000000000000697f31e074bf2c819391d52729f95506e0a72ffb0000000000000000c8000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000e48656c6c6f20576f726d686f6c6521000000000000000000000000000000000000";

  console.log('🧪 Testing with real Arbitrum Sepolia VAA on DEVNET');
  console.log('📍 Guardian: 0x13947Bd48b18E53fdAeEe77F3473391aC727C638');
  console.log('📍 Signature: 0x4682bc4d5ff2e54dc2ee5e0eb64f5c6c07aa449ac539abc63c2be5c306a48f233e9300170a82adf3c3b7f43f23176fb079174a58d67d142477f646675d86eb6301');
  console.log('📍 Expected message hash: 0xe64320fba193c98f2d0acf3a8c7479ec9b163192bfc19d4024497d4e4159758c');
  console.log('📍 WormholeScan: https://wormholescan.io/#/tx/0xf93fd41efeb09ff28174824d4abf6dbc06ac408953a9975aa4a403d434051efc?network=Testnet&view=advanced');
  console.log(`📡 Service status: ${isReady}`);


  // Ensure service is ready
  if (!isReady) {
    return res.status(503).json({
      success: false,
      error: 'Service not ready - Aztec devnet connection still initializing'
    });
  }

    const testReq = { body: { vaaBytes: realVAA }, isTest: true };

  try {
    const { vaaBytes } = testReq.body;

    const result = await vaaService.verifyVaaBytes(vaaBytes, {
      includeDebug: true,
      debugLabel: 'Test endpoint',
    });

    res.json({
      success: true,
      network: 'devnet',
      txHash: result.txHash,
      message: 'VAA verified successfully on Aztec devnet (TEST ENDPOINT)',
      processedAt: new Date().toISOString(),
      vaaLength: result.vaaLength,
    });
  } catch (error: any) {
    console.error('❌ VAA verification failed on DEVNET:', error.message);
    console.error('❌ Full error:', error);
    res.status(500).json({
      success: false,
      network: 'devnet',
      error: error.message,
      processedAt: new Date().toISOString()
    });
  }
});

async function init() {
  vaaService = await WormholeVaaService.init();
}

function isReady(): boolean {
  return vaaService && vaaService.isReady();
}

// Start server
init().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 VAA Verification Service running on port ${PORT}`);
    console.log(`🌐 Network: DEVNET`);
    console.log(`📡 Node: ${AZTEC_NODE_URL}`);
    console.log(`📄 Contract: ${AZTEC_WORMHOLE_ADDRESS}`);
    console.log('Available endpoints:');
    console.log('  GET  /health - Health check');
    console.log('  POST /verify - Verify VAA on devnet');
    console.log('  POST /test   - Test with real Arbitrum Sepolia VAA');
  });
}).catch(error => {
  console.error('❌ Failed to start devnet service:', error);
  console.log('\n📝 Required environment variables:');
  console.log('  PRIVATE_KEY=your_testnet_private_key');
  console.log('  CONTRACT_ADDRESS=your_deployed_contract_address');
  process.exit(1);
});
