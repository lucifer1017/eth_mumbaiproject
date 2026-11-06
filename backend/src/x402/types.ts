// Returned in the response body when a server replies 402.
export interface PaymentRequirements {
  scheme:            string
  network:           string
  maxAmountRequired: string // USDC amount, smallest unit (6 dec), e.g. "10000" = 0.01 USDC
  asset:             string // USDC contract address
  payTo:             string // server wallet
  description:       string
}

// Proof-of-payment constructed by the client, sent in X-Payment header on retry.
export interface Payment {
  scheme:  string
  network: string
  asset:   string
  payload: {
    from:  string // payer EOA
    value: string // must match maxAmountRequired
    nonce: string // unique per request
  }
}
