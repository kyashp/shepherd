import path from "node:path";

export interface LiveRuntimeLayout {
  liveRoot: string;
  dataDirectory: string;
  workspaceRoot: string;
  codexHome: string;
  shepherdRoot: string;
  shepherdCodexHomeRoot: string;
  containerStateRoot: string | undefined;
  containerStateVolume: string | undefined;
}

function isStrictChild(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export function resolveLiveRuntimeLayout(
  environment: NodeJS.ProcessEnv,
  repositoryRoot: string,
): LiveRuntimeLayout {
  const requestedRoot = environment.SHEPHERD_LIVE_GATE_ROOT;
  const stateRoot = environment.CONTAINER_STATE_ROOT;
  const stateVolume = environment.CONTAINER_STATE_VOLUME;
  const volumeMode = [requestedRoot, stateRoot, stateVolume].some(
    (value) => value !== undefined,
  );
  if (volumeMode && (!requestedRoot || !stateRoot || !stateVolume)) {
    throw new Error(
      "SHEPHERD_LIVE_GATE_ROOT, CONTAINER_STATE_ROOT, and CONTAINER_STATE_VOLUME must be provided together",
    );
  }

  const liveRoot = volumeMode
    ? path.resolve(requestedRoot!)
    : path.join(repositoryRoot, ".tmp", "shepherd-live-gate");
  if (volumeMode) {
    if (path.resolve(stateRoot!) !== stateRoot || path.resolve(requestedRoot!) !== requestedRoot) {
      throw new Error("Live Runtime volume paths must be absolute canonical paths");
    }
    if (!isStrictChild(stateRoot!, liveRoot)) {
      throw new Error("SHEPHERD_LIVE_GATE_ROOT must be inside CONTAINER_STATE_ROOT");
    }
  }

  return {
    liveRoot,
    dataDirectory: path.join(liveRoot, "data"),
    workspaceRoot: path.join(liveRoot, "agent-workspaces"),
    codexHome: path.join(liveRoot, "shared-codex-home"),
    shepherdRoot: path.join(liveRoot, "managed"),
    shepherdCodexHomeRoot: path.join(liveRoot, "data", "shepherd-codex-homes"),
    containerStateRoot: volumeMode ? stateRoot : undefined,
    containerStateVolume: volumeMode ? stateVolume : undefined,
  };
}
