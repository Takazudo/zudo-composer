import type { HostedServiceOptions, HostedTransport, HostedState, HostedSnapshot } from "zudo-composer/hosted-content";
import type { HostedConformanceFactory } from "zudo-composer/hosted-content/testing";
export type WorkerContract = { service: HostedServiceOptions; transport: HostedTransport; state: HostedState; snapshot: HostedSnapshot; tests: HostedConformanceFactory };
