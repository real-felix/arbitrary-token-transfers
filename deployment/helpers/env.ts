import fs from "fs";
import { ethers } from "ethers";
import { validateSolAddress } from "./solana.js";
import { ChainConfig, ChainInfo, ContractsJson, Dependencies, DependenciesConfig, Ecosystem, VerificationApiKeys, UncheckedConstructorArgs } from "./interfaces.js";
import { getSigner } from "./evm.js";
// TODO: support different env files
import 'dotenv/config';
import { ChainId, Token, contracts as connectDependencies, toChain } from "@wormhole-foundation/sdk-base";
import { getTokensBySymbol } from "@wormhole-foundation/sdk-base/tokens";

export const env = getEnv("ENV");
export const contracts = loadContracts();
export const dependencies = loadDependencies();
export const ecosystemChains = loadEcosystem();
export const verificationApiKeys = loadVerificationApiKeys();

function loadJson<T>(filename: string): T {
  const fileContent = fs.readFileSync(
    `./config/${env}/${filename}.json`
  );
  
  return JSON.parse(fileContent.toString()) as T;
}

function loadDependencies(): DependenciesConfig[] {
  return loadJson<DependenciesConfig[]>("dependencies");
}

function loadContracts<T extends ContractsJson>() {
  return loadJson<T>("contracts");
}

function loadEcosystem(): Ecosystem {
  return loadJson<Ecosystem>("ecosystem");
}

function loadVerificationApiKeys() {
  return loadJson<VerificationApiKeys[]>("verification-api-keys");
}

export function getEnv(env: string): string {
  const v = process.env[env];
  if (!v) {
    throw Error(`Env var not set: ${env}`);
  }
  return v;
}

export function getChainInfo(chainId: ChainId): ChainInfo {
  if (ecosystemChains.solana.networks.length > 1) {
    throw Error("Unexpected number of Solana networks.");
  }

  const chains = [
    ...ecosystemChains.evm.networks,
    ...ecosystemChains.solana.networks,
  ];

  const chain = chains.find((c) => c.chainId === chainId);
  if (chain === undefined) {
    throw Error(`Failed to find chain info for chain id: ${chainId}`);
  }

  return chain;
}

export async function getChainConfig<T extends ChainConfig>(filename: string, whChainId: ChainId): Promise<T> {
  const scriptConfig: T[] = await loadJson(filename);

  const chainConfig = scriptConfig.find((x) => x.chainId == whChainId);

  if (!chainConfig) {
    throw Error(`Failed to find ${filename} config for chain ${whChainId}`);
  }

  return chainConfig;
}

export function getContractAddress(contractName: string, whChainId: ChainId): string {
  const contract = contracts[contractName]?.find((c) => c.chainId === whChainId)?.address;

  if (!contract) {
    throw new Error(`No ${contractName} contract found for chain ${whChainId}`);
  }


  if (!ethers.isAddress(contract) && !validateSolAddress(contract)){
    throw new Error(`Invalid address for ${contractName} contract found for chain ${whChainId}`);
  }

  return contract;
}

export function getLocalDependencyAddress(dependencyName: keyof Dependencies, chain: ChainInfo): string {
  const chainDependencies = dependencies.find((d) => d.chainId === chain.chainId);

  if (chainDependencies === undefined ) {
    throw new Error(`No dependencies found for chain ${chain.chainId}`);
  }

  const dependency = chainDependencies[dependencyName as keyof Dependencies] as string;
  if (dependency === undefined) {
    throw new Error(`No dependency found for ${String(dependencyName)} for chain ${chain.chainId}`);
  }

  
  if (!ethers.isAddress(dependency) && !validateSolAddress(dependency)){
    throw new Error(`Invalid address for ${String(dependencyName)} dependency found for chain ${chain.chainId}`);
  }

  return dependency;
}

export function getDependencyAddress(dependencyName: keyof Dependencies, chain: ChainInfo): string {
  const {
    coreBridge,
    tokenBridge,
  } = connectDependencies;


  const dependencies = {
    wormhole: coreBridge.get(chain.network, toChain(chain.chainId)),
    tokenBridge: tokenBridge.get(chain.network, toChain(chain.chainId)),
  } as Dependencies;
  const connectDependency = dependencies[dependencyName as keyof Dependencies];
  
  try {
    const localDependency = getLocalDependencyAddress(dependencyName, chain);
    return localDependency === connectDependency ? connectDependency : localDependency;
  } catch (e) {
    if (connectDependency === undefined) {
      throw new Error(`No dependency found for ${String(dependencyName)} for chain ${chain.chainId} on connect sdk`);
    }

    return connectDependency;
  }
}

export async function getContractInstance(
  contractName: string,
  contractAddress: string,
  chain: ChainInfo,
): Promise<ethers.BaseContract> {
  const factory = require("../contract-bindings")[`${contractName}__factory`];
  const signer = await getSigner(chain);
  return factory.connect(contractAddress, signer);
}

export function getDeploymentArgs(contractName: string, whChainId: ChainId): UncheckedConstructorArgs {
  const constructorArgs = contracts[contractName]?.find((c) => c.chainId === whChainId)?.constructorArgs;

  if (!constructorArgs) {
    throw new Error(`No constructorArgs found for ${contractName} contract for chain ${whChainId}`);
  }

  return constructorArgs;
}

export function writeDeployedContract(whChainId: ChainId, contractName: string, address: string, constructorArgs: UncheckedConstructorArgs ) {
  const contracts = loadContracts();
  if (!contracts[contractName]) {
    contracts[contractName] = [{ chainId: whChainId, address, constructorArgs }];
  }

  else if (!contracts[contractName].find((c) => c.chainId === whChainId)) {
    contracts[contractName].push({ chainId: whChainId, address, constructorArgs });
  }

  else {
    contracts[contractName] = contracts[contractName].map((c) => {
      if (c.chainId === whChainId) {
        return { chainId: whChainId, address, constructorArgs };
      }

      return c;
    });
  }
  
  fs.writeFileSync(
    `./config/${env}/contracts.json`,
    JSON.stringify(contracts, null, 2),
    { flag: "w" }
  );
}