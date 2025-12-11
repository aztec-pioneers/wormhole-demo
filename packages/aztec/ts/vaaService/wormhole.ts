import "dotenv/config";
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { getPXEConfig } from '@aztec/pxe/server';
import { createStore } from "@aztec/kv-store/lmdb"
import { TestWallet } from '@aztec/test-wallet/server';
import ProxyLogger from './utils';
import { getPriorityFeeOptions, getSponsoredPaymentMethod } from '../fees';
import { WormholeContract, WormholeContractArtifact } from '../artifacts';
import { VAAVerificationResult } from './types';

// DEVNET CONFIGURATION
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL;
const ROLLUP_VERSION = process.env.ROLLUP_VERSION;
const AZTEC_RELAYER_PRIVATE_KEY = process.env.AZTEC_RELAYER_PRIVATE_KEY;
const AZTEC_RELAYER_SALT = process.env.AZTEC_RELAYER_SALT;
const AZTEC_WORMHOLE_ADDRESS = process.env.AZTEC_WORMHOLE_ADDRESS;

// Initialize Aztec Wormhole VAA Service
export default class WormholeVaaService {

    constructor(
        private node: AztecNode,
        private wallet: TestWallet,
        private relayerAddress: AztecAddress,
        private wormholeContract: WormholeContract,
        private paymentMethod: SponsoredFeePaymentMethod
    ) {
        console.log(`✅ Aztec Wormhole VAA Relayer Service Setup Successfully on Devnet`);
    }

    static async init(): Promise<WormholeVaaService> {
        // 1. Validate environment variables
        if (!AZTEC_NODE_URL) throw new Error('AZTEC_NODE_URL not set in .env');
        if (!ROLLUP_VERSION) throw new Error('ROLLUP_VERSION not set in .env');
        if (!AZTEC_RELAYER_PRIVATE_KEY) throw new Error('AZTEC_RELAYER_PRIVATE_KEY not set in .env');
        if (!AZTEC_RELAYER_SALT) throw new Error('AZTEC_RELAYER_SALT not set in .env');
        if (!AZTEC_WORMHOLE_ADDRESS) throw new Error('AZTEC_WORMHOLE_ADDRESS not set in .env');

        // 2. Initialize Aztec Node and Wallet
        const node = createAztecNodeClient(AZTEC_NODE_URL);
        ProxyLogger.create();
        const pxeConfig = { ...getPXEConfig(), rollupVersion: Number(ROLLUP_VERSION) };
        const pxeOptions = {
            store: await createStore('pxe', {
                dataDirectory: 'store',
                dataStoreMapSizeKb: 1e6,
            }),
            loggers: {
                prover: ProxyLogger.getInstance().createLogger('pxe:bb:wasm:bundle:proxied'),
            }
        };
        const wallet = await TestWallet.create(node, pxeConfig, pxeOptions);
        console.log('🛠️ Connected wallet to Aztec node and initialized');

        // 2. ensure relayer account registered in the wallet
        const relayerSecretKey = Fr.fromString(AZTEC_RELAYER_PRIVATE_KEY);
        const relayerSalt = Fr.fromString(AZTEC_RELAYER_SALT);
        const relayerAddress = await wallet.createSchnorrAccount(relayerSecretKey, relayerSalt)
            .then(manager => manager.address);
        console.log(`🛠️ Relayer account registered - using "${relayerAddress.toString()}"`);

        // 3. ensure FPC registered in wallet and get payment method
        const paymentMethod = await getSponsoredPaymentMethod(wallet);

        // 4. ensure wormhole contract is registered
        const wormholeAddress = AztecAddress.fromString(AZTEC_WORMHOLE_ADDRESS);
        const wormholeInstance = await node.getContract(wormholeAddress);
        if (!wormholeInstance)
            throw new Error(`Wormhole contract not found at address ${AZTEC_WORMHOLE_ADDRESS}`);
        await wallet.registerContract(wormholeInstance, WormholeContractArtifact);
        const wormholeContract = await WormholeContract.at(wormholeAddress, wallet);
        console.log('🛠️ Wormhole contract registered');
        return new WormholeVaaService(
            node,
            wallet,
            relayerAddress,
            wormholeContract,
            paymentMethod
        );
    }

    async verifyVaaBytes(
        vaaHex: string,
        { debugLabel = 'VAA verification', includeDebug = false } = {}
    ): Promise<VAAVerificationResult> {
        // 1. Validate service is ready
        if (!this.wormholeContract)
            throw new Error('Aztec Wormhole Relayer VAA Service not ready!');

        // 2. Setup debug logging
        const labelPrefix = includeDebug ? `🔍 ${debugLabel}:` : undefined;
        const log = includeDebug
            ? (msg: string) => console.log(`${labelPrefix} ${msg}`)
            : () => { };

        // 3. Parse VAA hex string to buffer
        const hexString = vaaHex.startsWith('0x') ? vaaHex.slice(2) : vaaHex;
        const vaaBuffer = Buffer.from(hexString, 'hex');
        log(`raw hex length=${hexString.length}, buffer length=${vaaBuffer.length}`);
        log(`first 20 bytes: ${vaaBuffer.subarray(0, 20).toString('hex')}`);
        log(`last 20 bytes: ${vaaBuffer.subarray(vaaBuffer.length - 20).toString('hex')}`);

        // 4. Pad VAA to max size for function (circuit) input
        const paddedVAA = Buffer.alloc(2000);
        vaaBuffer.copy(paddedVAA, 0, 0, Math.min(vaaBuffer.length, 2000));
        const vaaArray = Array.from(paddedVAA);
        const actualLength = vaaBuffer.length;
        log(`padded length=${vaaArray.length}, actualLength=${actualLength}`);

        // 5. Call verify_vaa on the Wormhole contract and wait for tx
        const tx = await this.wormholeContract.methods.verify_vaa(vaaArray, actualLength)
            .send({
                from: this.relayerAddress,
                fee: {
                    ...(await getPriorityFeeOptions(this.node, 2n)), // overshoot priority fee
                    paymentMethod: this.paymentMethod,
                },
            })
            .wait();
        log(`tx sent: ${tx.txHash}`);
        console.log(`✅ ${debugLabel} - VAA verified successfully on Aztec devnet: ${tx.txHash}`);

        return { txHash: tx.txHash, vaaLength: actualLength };
    }

    isReady(): boolean {
        return !!this.wormholeContract;
    }

    getRelayerAddress(): AztecAddress {
        return this.relayerAddress;
    }
}

