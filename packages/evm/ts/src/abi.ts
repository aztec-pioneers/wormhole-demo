export const MESSAGE_BRIDGE_ABI = [
    {
        name: "owner",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "address" }],
    },
    {
        name: "WORMHOLE",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "address" }],
    },
    {
        name: "CHAIN_ID",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint16" }],
    },
    {
        name: "currentValue",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint128" }],
    },
    {
        name: "registeredEmitters",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "chainId", type: "uint16" }],
        outputs: [{ type: "bytes32" }],
    },
    {
        name: "registerEmitters",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "remoteChainIds", type: "uint16[]" },
            { name: "emitterAddresses", type: "bytes32[]" },
            { name: "_isDefaultPayloads", type: "bool[]" },
        ],
        outputs: [],
    },
    {
        name: "sendValue",
        type: "function",
        stateMutability: "payable",
        inputs: [
            { name: "destinationChainId", type: "uint16" },
            { name: "value", type: "uint128" },
        ],
        outputs: [{ name: "sequence", type: "uint64" }],
    },
    {
        name: "receiveValue",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "encodedVm", type: "bytes" }],
        outputs: [],
    },
] as const;

export const WORMHOLE_ABI = [
    {
        name: "messageFee",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
    },
] as const;