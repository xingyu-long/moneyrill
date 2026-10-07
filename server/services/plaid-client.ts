import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { config } from '../lib/config.ts';

export const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[config.plaidEnv],
    baseOptions: {
      timeout: 25000,
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  }),
);
