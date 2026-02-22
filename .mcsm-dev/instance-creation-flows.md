# MCSManager Instance Creation Flows

Reference document for understanding how instances are created in MCSManager.

---

## Architecture Overview

MCSManager follows a **Panel-Daemon architecture**:
- **Panel** = Central management server (REST API + Web UI)  
- **Daemon** = Worker node that actually runs instances

All instance creation ultimately happens on the **Daemon**, initiated from the **Panel** via WebSocket.

```
┌─────────────────────────────────┐     ┌──────────────────────────────────┐
│         Panel (Central)         │     │        Daemon (Worker)           │
├─────────────────────────────────┤     ├──────────────────────────────────┤
│  Web Frontend                   │     │  WebSocket Router                │
│         ↓                       │     │         ↓                        │
│  REST API Routers               │────▶│  InstanceSubsystem               │
│         ↓                       │ WS  │         ↓                        │
│  RemoteRequest Service          │     │  Instance Entity + Storage       │
└─────────────────────────────────┘     └──────────────────────────────────┘
```

---

## Instance Creation Methods

### Summary Table

| # | UI Method | Enum Key | API Flow | Description |
|---|-----------|----------|----------|-------------|
| 1 | Marketplace Quick Install | `FAST` | Async task | Install preset packages from app store |
| 2 | Docker Image | `DOCKER` | Direct API | Create instance using Docker image |
| 3 | Single File Upload | `FILE` | Upload flow | Upload `.jar` file and configure |
| 4 | ZIP Import | `IMPORT` | Upload flow | Upload `.zip` package with server files |
| 5 | Select Existing Directory | `SELECT` | Direct API | Point to files already on daemon |
| 6 | Empty Instance | `EXIST` | Direct API | Create blank instance with no files |

### Backend API Flows

| API Endpoint | Description | Used By |
|--------------|-------------|---------|
| `POST /api/instance` | Create instance with config | DOCKER, SELECT, EXIST |
| `POST /api/instance/upload` | Create + get upload passport | FILE, IMPORT |
| `POST /api/protected_instance/asynchronous` | Async quick install task | Marketplace FAST |

---

## Detailed Flows

### 1. Marketplace Quick Install (FAST)

Creates an instance and downloads a preset package.

**Frontend:** `McPreset.vue` → `AppPackages.vue` → `TemplateNameDialog.vue`

**Flow:**
1. User selects template from marketplace
2. User confirms instance name
3. Frontend calls `POST /api/protected_instance/asynchronous`
   - `task_name: "quick_install"`
   - `newInstanceName`, `targetLink`, `setupInfo`
4. Panel forwards to Daemon: `instance/asynchronous`
5. Daemon creates `QuickInstallTask`:
   - Creates instance internally
   - Downloads package from `targetLink`
   - Unzips package
   - Reads `mcsmanager-config.json`
   - Applies configuration
   - Runs `updateCommand` if present
6. Frontend redirects to terminal page

**Key files:**
- `frontend/src/widgets/setupApp/McPreset.vue`
- `frontend/src/widgets/setupApp/AppPackages.vue`
- `daemon/src/service/async_task_service/quick_install.ts`

---

### 2. Docker Image Creation (DOCKER)

Creates an instance configured to run inside a Docker container.

**Frontend:** `CreateInstanceForm.vue` (DOCKER mode)

**Flow:**
1. User fills form with Docker config:
   - `docker.image`: Image name (e.g., `eclipse-temurin:17`)
   - `docker.workingDir`: Container working directory
   - `startCommand`, `stopCommand`
2. Frontend sets `processType: "docker"` automatically
3. Frontend calls `POST /api/instance`
4. Panel forwards to Daemon: `instance/new`
5. Daemon creates instance via `InstanceSubsystem.createInstance()`
6. `FunctionDispatcher` assigns `DockerStartCommand` preset

**Important:** Docker image is NOT pulled at creation time. It's pulled when the instance is **started**.

**Docker Pull on Start:**
1. User starts instance → `execPreset("start")`
2. `DockerStartCommand.exec()` runs
3. `DockerPullCommand` checks if image exists
4. If not, pulls image and polls every 3s until ready
5. Container is created and started
6. Volume mounts applied (cwd → container workingDir)

**Key files:**
- `frontend/src/widgets/setupApp/CreateInstanceForm.vue` (lines 253-302)
- `daemon/src/entity/commands/docker/docker_start.ts`
- `daemon/src/entity/commands/docker/docker_pull.ts`
- `daemon/src/service/docker_process_service.ts`

---

### 3 & 4. File Upload (FILE / IMPORT)

Creates instance then uploads files to daemon.

**Frontend:** `CreateInstanceForm.vue` (FILE or IMPORT mode)

**Flow:**
1. User fills form + selects file
2. Frontend calls `POST /api/instance/upload`
3. Panel creates instance via Daemon
4. Panel registers upload passport
5. Panel returns `{instanceUuid, password, addr}`
6. Frontend uploads file via HTTP with passport
7. Daemon receives file:
   - IMPORT: Unzips to instance cwd
   - FILE: Saves to instance cwd

**Key files:**
- `frontend/src/widgets/setupApp/CreateInstanceForm.vue`
- `panel/src/app/routers/instance_admin_router.ts` (`/upload` endpoint)
- `daemon/src/routers/http_router.ts`

---

### 5 & 6. Select Directory / Empty Instance (SELECT / EXIST)

Both use the same API with different configurations.

**Frontend:** `CreateInstanceForm.vue`

**Flow:**
1. User fills form
   - SELECT: Provides existing `cwd` path
   - EXIST: Leaves `cwd` empty
2. Frontend calls `POST /api/instance`
3. Panel forwards to Daemon: `instance/new`
4. Daemon creates instance:
   - Empty cwd → generates `data/InstanceData/{uuid}`
   - Custom cwd → uses provided path

**Key files:**
- `panel/src/app/routers/instance_admin_router.ts`
- `daemon/src/routers/Instance_router.ts`
- `daemon/src/service/system_instance.ts`

---

### 7. Commercial Buy/Exchange (Internal)

Used by external platforms to purchase hosting.

**Flow:**
1. External platform calls `POST /exchange` with `action: "buy"`
2. Panel creates instance with `endTime` for expiration
3. Panel creates/updates user account
4. Returns credentials to external platform

**Key files:**
- `panel/src/app/routers/instance_exchange_router.ts`
- `panel/src/app/service/exchange_service.ts`

---

### 8. Load from Storage (Daemon Startup)

Restores persisted instances when daemon starts.

**Flow:**
1. `InstanceSubsystem.loadInstances()` called on startup
2. Lists all UUIDs from `StorageSubsystem`
3. For each UUID:
   - Loads `InstanceConfig` from storage
   - Creates `Instance` object
   - Runs `FunctionDispatcher`
   - Adds to instance map
4. Runs Docker container takeover (reconnects to orphaned containers)
5. Runs `autoStart()` for eligible instances

**Key files:**
- `daemon/src/service/system_instance.ts` (`loadInstances()`)
- `daemon/src/service/takeover_container.ts`

---

## Core Components

### InstanceSubsystem

Central singleton managing all instances on a daemon.

```typescript
class InstanceSubsystem {
  instances: Map<string, Instance>;
  
  createInstance(config): Instance;
  addInstance(instance): void;
  removeInstance(uuid, deleteFile): boolean;
  getInstance(uuid): Instance;
  loadInstances(): void;
}
```

### FunctionDispatcher

Assigns command handlers based on instance configuration.

| Condition | Start Command | Additional |
|-----------|---------------|------------|
| `processType: "general"` | `GeneralStartCommand` | - |
| `processType: "general"` + `pty: true` | `PtyStartCommand` | `PtyResizeCommand` |
| `processType: "docker"` | `DockerStartCommand` | `DockerResizeCommand`, `DockerStatsTask` |

### Process Types

| Type | Config | Description |
|------|--------|-------------|
| General | `processType: "general"` | Native subprocess (spawn) |
| PTY | `processType: "general"` + `terminalOption.pty: true` | Pseudo-terminal |
| Docker | `processType: "docker"` | Docker container |

---

## Instance Configuration Schema

Key fields in `InstanceConfig`:

```typescript
interface InstanceConfig {
  nickname: string;           // Display name
  startCommand: string;       // Command to start
  stopCommand: string;        // Command to stop (e.g., "stop", "^c")
  cwd: string;                // Working directory
  processType: "general" | "docker";
  type: string;               // minecraft/java, steam, universal
  
  // Docker-specific
  docker: {
    image: string;            // Docker image name
    containerName: string;
    ports: string[];          // "25565:25565/tcp"
    workingDir: string;       // Container working dir
    memory: number;           // MB limit
    cpuUsage: number;         // CPU percentage
    extraVolumes: string[];   // "hostPath|containerPath"
    env: string[];            // Environment variables
    networkMode: string;      // bridge, host, etc.
  };
  
  // Lifecycle
  eventTask: {
    autoStart: boolean;
    autoRestart: boolean;
    autoRestartMaxTimes: number;
  };
  
  endTime: number;            // Expiration timestamp (0 = no expiry)
}
```

---

## Data Locations

| Data Type | Location |
|-----------|----------|
| Config persistence | `data/InstanceConfig/{uuid}.json` |
| Instance files (default) | `data/InstanceData/{uuid}/` |
| Instance files (custom) | Configured `cwd` path |
| Logs | `data/InstanceLog/{uuid}.log` |

---

## Integration Points for Backup Module

### Hook Points

| Event | Location | Use Case |
|-------|----------|----------|
| Instance created | `InstanceSubsystem.addInstance()` | Register for backup |
| Instance deleted | `InstanceSubsystem.removeInstance()` | Cleanup backup config |
| Instance stopped | `instance.on("exit")` | Trigger auto-backup |
| Instance started | `instance.on("open")` | Validate last backup |

### LifeCycle Task Pattern

```typescript
export default class BackupLifeCycleTask implements ILifeCycleTask {
  public status: number = 0;
  public name: string = "BackupLifeCycleTask";

  async start(instance: Instance) {
    // Called when instance starts
  }

  async stop(instance: Instance) {
    // Called when instance stops - trigger backup
  }
}
```

### AsyncTask Pattern for Long Operations

```typescript
class RemoteBackupTask extends AsyncTask {
  public static TYPE = "RemoteBackupTask";
  
  async onStart(): Promise<void> {
    // Compress files, upload to cloud
  }
  
  async onStop(): Promise<void> {
    // Cleanup partial uploads
  }
}
```

### Important Considerations

- Check `instance.status() === Instance.STATUS_STOP` before backup
- Use `instance.absoluteCwdPath()` to get working directory
- Docker volume paths differ between host and container
- File locking available via `instance.info.fileLock`
