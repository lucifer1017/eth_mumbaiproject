export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Daemon API',
    version: '1.0.0',
    description: 'REST API for the Daemon Agent Marketplace'
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Local development server'
    }
  ],
  paths: {
    '/api/v1/config': {
      get: {
        summary: 'Get platform config',
        description: 'Returns public, non-secret platform info the frontend needs at runtime, such as the Permit2 spender address for one-time agent payments.',
        responses: {
          '200': { description: 'Platform config returned' }
        }
      }
    },
    '/api/v1/auth/nonce': {
      post: {
        summary: 'Request wallet nonce',
        description: 'Generates a login challenge nonce for the user address',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address'],
                properties: {
                  user_address: { type: 'string', description: 'Checksummed wallet address' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Nonce returned' }
        }
      }
    },
    '/api/v1/auth/verify': {
      post: {
        summary: 'Verify wallet signature',
        description: 'Authenticates a user session with a signed message signature',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address', 'signature'],
                properties: {
                  user_address: { type: 'string' },
                  signature: { type: 'string', description: 'ECDSA signature' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Session verified' }
        }
      }
    },
    '/api/v1/user/onboard': {
      post: {
        summary: 'Onboard a user',
        description: 'Configures roles (creator or subscriber) and handles',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address', 'handle', 'role'],
                properties: {
                  user_address: { type: 'string' },
                  handle: { type: 'string' },
                  role: { type: 'string', enum: ['subscriber', 'creator'] }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'User onboarded' }
        }
      }
    },
    '/api/v1/user/subscriptions': {
      post: {
        summary: 'List user subscriptions',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address'],
                properties: {
                  user_address: { type: 'string' },
                  status: { type: 'string', enum: ['active', 'cancelled', 'expired'], default: 'active' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'List of user subscriptions' }
        }
      }
    },
    '/api/v1/user/billing': {
      post: {
        summary: 'Fetch user billing metrics',
        description: 'Returns the subscriber USDC wallet balance and next subscription payment due',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address'],
                properties: {
                  user_address: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Billing overview' }
        }
      }
    },
    '/api/v1/user/runs': {
      post: {
        summary: 'List user runs activity',
        description: 'Queries execution logs (subscriptions cycles & one-time runs) for a subscriber',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address'],
                properties: {
                  user_address: { type: 'string' },
                  page: { type: 'integer', default: 1 },
                  limit: { type: 'integer', default: 20 }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'List of executions' }
        }
      }
    },
    '/api/v1/agents': {
      get: {
        summary: 'Discover marketplace agents',
        parameters: [
          { name: 'category', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'search', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sort', in: 'query', required: false, schema: { type: 'string', enum: ['popular', 'rating', 'price_asc', 'price_desc', 'newest'] } },
          { name: 'page', in: 'query', required: false, schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20 } }
        ],
        responses: {
          '200': { description: 'Marketplace listings' }
        }
      }
    },
    '/api/v1/agents/{agent_id}': {
      get: {
        summary: 'Get agent details',
        parameters: [
          { name: 'agent_id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Agent profile details' }
        }
      }
    },
    '/api/v1/agents/{onchain_agent_id}/card.json': {
      get: {
        summary: 'Host ERC-8004 AgentCard URI',
        description: 'Returns metadata conforming to ERC-8004 tokenURI layout',
        parameters: [
          { name: 'onchain_agent_id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'AgentCard JSON' }
        }
      }
    },
    '/api/v1/runs': {
      post: {
        summary: 'Record one-time invocation run',
        description: 'Saves the result metadata of a direct x402 browser-to-agent transaction',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['subscriber', 'agent_id', 'amount'],
                properties: {
                  subscriber: { type: 'string' },
                  agent_id: { type: 'string' },
                  amount: { type: 'string', description: 'USDC amount paid' },
                  status_message: { type: 'string' },
                  link: { type: 'string', description: 'Transaction link or output URL' },
                  tx_hash: { type: 'string' },
                  success: { type: 'boolean', default: true }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Run recorded' }
        }
      }
    },
    '/api/v1/subscriptions': {
      post: {
        summary: 'Register an active on-chain subscription',
        description: 'Creates a database record mirroring a subscription created on the smart contract',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address', 'agent_id', 'onchain_sub_id'],
                properties: {
                  user_address: { type: 'string' },
                  agent_id: { type: 'string' },
                  onchain_sub_id: { type: 'string', description: 'Bytes32 contract subscription ID' },
                  tx_hash: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Subscription created' }
        }
      }
    },
    '/api/v1/subscriptions/{id}/cancel': {
      post: {
        summary: 'Cancel subscription',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address'],
                properties: {
                  user_address: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Subscription cancelled' }
        }
      }
    },
    '/api/v1/creator/agents/list': {
      post: {
        summary: 'List creator agents',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address'],
                properties: {
                  user_address: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'List of creator agents' }
        }
      }
    },
    '/api/v1/creator/agents/register': {
      post: {
        summary: 'Register agent listing',
        description: 'Registers a newly created service factory agent inside the database',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address', 'name', 'category', 'mode', 'services'],
                properties: {
                  user_address: { type: 'string' },
                  name: { type: 'string' },
                  category: { type: 'string' },
                  description: { type: 'string' },
                  short_description: { type: 'string' },
                  logo_url: { type: 'string' },
                  services: { type: 'array', items: { type: 'string' } },
                  mode: { type: 'string', enum: ['subscription', 'one_time', 'both'] },
                  sub_price_amount: { type: 'string' },
                  interval_seconds: { type: 'integer' },
                  payment_frequency: { type: 'string', enum: ['weekly', 'monthly', 'test_5min', 'test_2min'] },
                  one_time_price_amount: { type: 'string' },
                  param_schema: { type: 'array', items: { type: 'object' } },
                  service_address: { type: 'string' },
                  onchain_agent_id: { type: 'string' },
                  agent_card_uri: { type: 'string' },
                  endpoint_url: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Agent registered' }
        }
      }
    },
    '/api/v1/creator/agents/update': {
      post: {
        summary: 'Update agent listing metadata',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address', 'agent_id'],
                properties: {
                  user_address: { type: 'string' },
                  agent_id: { type: 'string' },
                  name: { type: 'string' },
                  category: { type: 'string' },
                  short_description: { type: 'string' },
                  services: { type: 'array', items: { type: 'string' } },
                  mode: { type: 'string', enum: ['subscription', 'one_time', 'both'] },
                  sub_price_amount: { type: 'string' },
                  interval_seconds: { type: 'integer' },
                  one_time_price_amount: { type: 'string' },
                  status: { type: 'string', enum: ['live', 'paused'] }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Agent updated' }
        }
      }
    },
    '/api/v1/creator/earnings': {
      post: {
        summary: 'Fetch creator earnings and stats',
        description: 'Calculates active subscribers, net MRR, total withdrawn, lifetime revenue, monthly revenue charts, and withdrawals log.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_address'],
                properties: {
                  user_address: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Earnings report' }
        }
      }
    }
  }
}
