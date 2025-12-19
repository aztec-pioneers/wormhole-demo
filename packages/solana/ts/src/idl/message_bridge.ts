/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/message_bridge.json`.
 */
export type MessageBridge = {
  "address": "6eLf6j8YhfhB95kYPRpeUDdF1JWTdECNnsKmUpxwdAjp",
  "metadata": {
    "name": "messageBridge",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "initialize",
      "docs": [
        "Initialize the message bridge program",
        "",
        "This sets up the config account with Wormhole addresses and creates",
        "the emitter PDA that will sign outbound messages."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Program owner who pays for account creation"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "Config account (PDA)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "currentValue",
          "docs": [
            "Current value storage account (PDA)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  114,
                  101,
                  110,
                  116,
                  95,
                  118,
                  97,
                  108,
                  117,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "wormholeEmitter",
          "docs": [
            "Wormhole emitter account (PDA)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  109,
                  105,
                  116,
                  116,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "wormholeProgram",
          "docs": [
            "Wormhole program"
          ],
          "address": "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5"
        },
        {
          "name": "wormholeBridge",
          "docs": [
            "Wormhole bridge data account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  66,
                  114,
                  105,
                  100,
                  103,
                  101
                ]
              }
            ],
            "program": {
              "kind": "account",
              "path": "wormholeProgram"
            }
          }
        },
        {
          "name": "wormholeFeeCollector",
          "docs": [
            "Wormhole fee collector"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  101,
                  101,
                  95,
                  99,
                  111,
                  108,
                  108,
                  101,
                  99,
                  116,
                  111,
                  114
                ]
              }
            ],
            "program": {
              "kind": "account",
              "path": "wormholeProgram"
            }
          }
        },
        {
          "name": "wormholeSequence",
          "docs": [
            "Wormhole sequence account (will be created)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  83,
                  101,
                  113,
                  117,
                  101,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "wormholeEmitter"
              }
            ],
            "program": {
              "kind": "account",
              "path": "wormholeProgram"
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "receiveValue",
      "docs": [
        "Receive a value from another chain via Wormhole",
        "",
        "The VAA must be posted and verified before calling this instruction.",
        "The received message account provides replay protection.",
        "",
        "# Arguments",
        "* `vaa_hash` - Hash of the VAA (used for verification)",
        "* `emitter_chain` - Source chain ID from the VAA",
        "* `sequence` - Sequence number from the VAA"
      ],
      "discriminator": [
        131,
        101,
        246,
        45,
        2,
        139,
        81,
        21
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Payer for account creation"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "Config account"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "currentValue",
          "docs": [
            "Current value storage (to update)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  114,
                  101,
                  110,
                  116,
                  95,
                  118,
                  97,
                  108,
                  117,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "wormholeProgram",
          "docs": [
            "Wormhole program"
          ],
          "address": "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5"
        },
        {
          "name": "postedVaa",
          "docs": [
            "Posted VAA account (verified by Wormhole)"
          ]
        },
        {
          "name": "foreignEmitter",
          "docs": [
            "Foreign emitter (must match VAA emitter - validation done in instruction)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  111,
                  114,
                  101,
                  105,
                  103,
                  110,
                  95,
                  101,
                  109,
                  105,
                  116,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "emitterChain"
              }
            ]
          }
        },
        {
          "name": "receivedMessage",
          "docs": [
            "Received message account (for replay protection)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  118,
                  101,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "emitterChain"
              },
              {
                "kind": "arg",
                "path": "sequence"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "vaaHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "emitterChain",
          "type": "u16"
        },
        {
          "name": "sequence",
          "type": "u64"
        }
      ]
    },
    {
      "name": "registerEmitter",
      "docs": [
        "Register a foreign emitter from another chain",
        "",
        "Only the owner can register emitters. Each chain can have one emitter.",
        "",
        "# Arguments",
        "* `chain_id` - Wormhole chain ID of the foreign chain",
        "* `emitter_address` - Emitter address on the foreign chain (32 bytes)",
        "* `is_default_payload` - true for default 18-byte payload (Solana/EVM), false for Aztec 50-byte payload"
      ],
      "discriminator": [
        217,
        153,
        40,
        34,
        190,
        121,
        144,
        105
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Program owner"
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "docs": [
            "Config account (must match owner)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "foreignEmitter",
          "docs": [
            "Foreign emitter account to create (PDA by chain_id)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  111,
                  114,
                  101,
                  105,
                  103,
                  110,
                  95,
                  101,
                  109,
                  105,
                  116,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "chainId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "chainId",
          "type": "u16"
        },
        {
          "name": "emitterAddress",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "isDefaultPayload",
          "type": "bool"
        }
      ]
    },
    {
      "name": "sendValue",
      "docs": [
        "Send a value to another chain via Wormhole",
        "",
        "This posts a message to Wormhole that can be relayed to the destination chain."
      ],
      "discriminator": [
        165,
        247,
        104,
        64,
        24,
        235,
        166,
        189
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Payer for Wormhole fee"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "Config account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "wormholeEmitter",
          "docs": [
            "Wormhole emitter (PDA that signs messages)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  109,
                  105,
                  116,
                  116,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "wormholeProgram",
          "docs": [
            "Wormhole program"
          ],
          "address": "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5"
        },
        {
          "name": "wormholeBridge",
          "docs": [
            "Wormhole bridge data"
          ],
          "writable": true
        },
        {
          "name": "wormholeFeeCollector",
          "docs": [
            "Wormhole fee collector"
          ],
          "writable": true
        },
        {
          "name": "wormholeSequence",
          "docs": [
            "Wormhole sequence tracker"
          ],
          "writable": true
        },
        {
          "name": "wormholeMessage",
          "docs": [
            "Wormhole message account (PDA)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  115,
                  115,
                  97,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "config.nonce",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "destinationChainId",
          "type": "u16"
        },
        {
          "name": "value",
          "type": "u128"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "currentValue",
      "discriminator": [
        10,
        224,
        35,
        100,
        38,
        236,
        155,
        198
      ]
    },
    {
      "name": "foreignEmitter",
      "discriminator": [
        209,
        139,
        241,
        247,
        96,
        178,
        159,
        2
      ]
    },
    {
      "name": "receivedMessage",
      "discriminator": [
        8,
        20,
        37,
        21,
        175,
        34,
        29,
        238
      ]
    },
    {
      "name": "wormholeEmitter",
      "discriminator": [
        34,
        95,
        161,
        132,
        226,
        225,
        31,
        11
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "ownerOnly",
      "msg": "Only the owner can perform this action"
    },
    {
      "code": 6001,
      "name": "invalidWormholeConfig",
      "msg": "Invalid Wormhole configuration"
    },
    {
      "code": 6002,
      "name": "invalidForeignEmitter",
      "msg": "Invalid foreign emitter"
    },
    {
      "code": 6003,
      "name": "invalidDestinationChainId",
      "msg": "Invalid destination chain ID"
    },
    {
      "code": 6004,
      "name": "cannotRegisterSolanaEmitter",
      "msg": "Cannot register emitter for Solana chain"
    },
    {
      "code": 6005,
      "name": "zeroEmitterAddress",
      "msg": "Emitter address cannot be zero"
    },
    {
      "code": 6006,
      "name": "invalidPayload",
      "msg": "Invalid message payload"
    },
    {
      "code": 6007,
      "name": "alreadyProcessed",
      "msg": "Message already processed"
    },
    {
      "code": 6008,
      "name": "insufficientFee",
      "msg": "Insufficient fee for Wormhole message"
    }
  ],
  "types": [
    {
      "name": "config",
      "docs": [
        "Program configuration account"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Program owner (can register emitters)"
            ],
            "type": "pubkey"
          },
          {
            "name": "wormholeProgram",
            "docs": [
              "Wormhole program ID"
            ],
            "type": "pubkey"
          },
          {
            "name": "wormholeBridge",
            "docs": [
              "Wormhole bridge (core) account"
            ],
            "type": "pubkey"
          },
          {
            "name": "wormholeFeeCollector",
            "docs": [
              "Wormhole fee collector account"
            ],
            "type": "pubkey"
          },
          {
            "name": "wormholeEmitter",
            "docs": [
              "Wormhole emitter account (PDA)"
            ],
            "type": "pubkey"
          },
          {
            "name": "wormholeSequence",
            "docs": [
              "Wormhole sequence account"
            ],
            "type": "pubkey"
          },
          {
            "name": "chainId",
            "docs": [
              "Wormhole chain ID for Solana (1)"
            ],
            "type": "u16"
          },
          {
            "name": "nonce",
            "docs": [
              "Nonce for outbound messages"
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "currentValue",
      "docs": [
        "Current value storage (like EVM contract's currentValue)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "value",
            "docs": [
              "The current value received via cross-chain message"
            ],
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "foreignEmitter",
      "docs": [
        "Registered foreign emitter (one per chain)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "chainId",
            "docs": [
              "Wormhole chain ID of the foreign chain"
            ],
            "type": "u16"
          },
          {
            "name": "address",
            "docs": [
              "Emitter address on the foreign chain (32 bytes)"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "isDefaultPayload",
            "docs": [
              "Payload format: true = default 18-byte (Solana/EVM), false = Aztec 50-byte (with txId)"
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "receivedMessage",
      "docs": [
        "Received message (for replay protection)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sequence",
            "docs": [
              "Wormhole message sequence number"
            ],
            "type": "u64"
          },
          {
            "name": "emitterChain",
            "docs": [
              "Source chain ID"
            ],
            "type": "u16"
          },
          {
            "name": "value",
            "docs": [
              "The value that was received"
            ],
            "type": "u128"
          },
          {
            "name": "batchId",
            "docs": [
              "Batch ID (for grouping)"
            ],
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "wormholeEmitter",
      "docs": [
        "Wormhole emitter account (PDA that signs messages)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA derivation"
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
