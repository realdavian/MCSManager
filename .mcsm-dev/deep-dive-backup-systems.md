# Deep Dive: Systems for Backup Module

Technical analysis of existing systems relevant to the backup module implementation.

---

## 1. Compression System

**Location:** `daemon/src/common/compress.ts`

### How it Works

The compression system uses an **external Go binary** (`GOLANG_ZIP_PATH`) rather than Node.js libraries for performance.

```typescript
// Compress files to zip
async function useZip(distZip: string, files: string[], code = "utf-8"): Promise<boolean>

// Decompress zip (with 7zip fallback)
async function useUnzip(sourceZip: string, destDir: string, code = "utf-8"): Promise<boolean>
```

### Key Points for Backup

- **Go binary location:** `GOLANG_ZIP_PATH` constant
- **7-Zip fallback:** Also supports `SEVEN_ZIP_PATH` for other formats
- **Timeout:** `ZIP_TIMEOUT_SECONDS` constant applies
- **File name validation:** Disallows `"`, `'`, `?`, `|`, `&` in paths
- **Async:** Returns Promise, runs in subprocess

### Usage Example

```typescript
import { compress, decompress } from "../common/compress";

// Compress instance directory
await compress("/path/to/backup.zip", ["file1.txt", "folder/"], "utf-8");

// Decompress
await decompress("/path/to/backup.zip", "/dest/dir/", "utf-8");
```

---

## 2. Schedule System

**Location:** `daemon/src/service/system_instance_control.ts`

### Schedule Types

```typescript
export enum ScheduleActionTypeEnum {
  Delay = "delay",
  Command = "command",
  Stop = "stop",
  Start = "start",
  Restart = "restart",
  Kill = "kill"
  // TODO: Add Backup = "backup"
}

export const ScheduleTypeEnum = {
  Interval: 1,  // setInterval-based (seconds)
  Cycle: 2,     // node-schedule cron
  Specify: 3    // node-schedule cron (one-time)
};
```

### Task Configuration

```typescript
interface IScheduleTask {
  instanceUuid: string;
  name: string;
  count: number;          // -1 = infinite, otherwise decrement
  time: string;           // seconds (interval) or cron expression
  actions: IScheduleAction[];
  type: number;           // ScheduleTypeEnum
}

interface IScheduleAction {
  type: string;           // ScheduleActionTypeEnum
  payload: string;
}
```

### Key Points for Backup Schedule

- **Minimum interval:** 3 seconds (for interval type)
- **Max tasks per instance:** 8
- **Max actions per task:** 10
- **Persistence:** `StorageSubsystem.store("TaskConfig", key, config)`
- **Loaded on startup:** Constructor iterates stored tasks

### Adding Backup Action

1. Add `Backup = "backup"` to `ScheduleActionTypeEnum`
2. Add handler in `action()` method:

```typescript
if (actionType === ScheduleActionTypeEnum.Backup) {
  if (instanceStatus === Instance.STATUS_STOP) {
    // Trigger backup
    await instance.execPreset("backup");
  }
  continue;
}
```

---

## 3. Global Configuration

**Location:** `daemon/src/entity/config.ts`

### Pattern

```typescript
class Config {
  // Existing fields...
  public version = 2;
  public ip = "";
  public port = 24444;
  // etc...
  
  // TODO: Add storage providers
  public storageProviders: IStorageProviderConfig[] = [];
}

class GlobalConfiguration {
  public config = new Config();
  
  load() {
    let config = StorageSubsystem.load("Config", Config, "global");
    if (config == null) {
      config = new Config();
      StorageSubsystem.store("Config", "global", config);
    }
    this.config = config;
  }
  
  store() {
    StorageSubsystem.store("Config", "global", this.config);
  }
}

export const globalConfiguration = new GlobalConfiguration();
```

### Storage Provider Config

Add to `Config` class:

```typescript
public storageProviders: Array<{
  id: string;
  name: string;
  type: "s3" | "gcs";
  config: Record<string, any>;
}> = [];
```

---

## 4. Lifecycle Task System

**Location:** `daemon/src/entity/instance/life_cycle.ts`

### Interface

```typescript
export interface ILifeCycleTask {
  name: string;
  status: number;  // 0 = stopped, 1 = running
  start: (instance: Instance) => Promise<void>;
  stop: (instance: Instance) => Promise<void>;
}
```

### When Tasks Execute

| Event | Method Called |
|-------|---------------|
| Instance starts | `lifeCycleTaskManager.execLifeCycleTask(1)` |
| Instance stops | `lifeCycleTaskManager.execLifeCycleTask(0)` |

**From `instance.ts`:**
- Line 335: `started()` → calls `execLifeCycleTask(1)`
- Line 361: `stopped()` → calls `execLifeCycleTask(0)`

### Existing Example: TimeCheck

```typescript
export default class TimeCheck implements ILifeCycleTask {
  public status: number = 0;
  public name: string = "TimeCheck";
  private task: any = null;

  async start(instance: Instance) {
    this.task = setInterval(async () => {
      // Check expiration every hour
    }, 1000 * 60 * 60);
  }

  async stop(instance: Instance) {
    clearInterval(this.task);
  }
}
```

### Backup Lifecycle Task Pattern

```typescript
export default class BackupLifeCycleTask implements ILifeCycleTask {
  public status: number = 0;
  public name: string = "BackupLifeCycleTask";
  private scheduledBackupTimer: NodeJS.Timeout | null = null;

  async start(instance: Instance) {
    // Initialize scheduled backup timer if enabled
    if (instance.config.backupConfig?.scheduledBackup) {
      const interval = instance.config.backupConfig.scheduleInterval * 60 * 1000;
      this.scheduledBackupTimer = setInterval(() => {
        // Trigger backup
      }, interval);
    }
  }

  async stop(instance: Instance) {
    // Clear scheduled timer
    if (this.scheduledBackupTimer) {
      clearInterval(this.scheduledBackupTimer);
      this.scheduledBackupTimer = null;
    }
    
    // **MANDATORY**: Trigger on-stop backup
    if (instance.config.backupConfig?.enabled) {
      await this.triggerBackup(instance);
    }
  }
}
```

### Registering in FunctionDispatcher

```typescript
// In dispatcher.ts
if (instance.config.backupConfig?.enabled) {
  instance.lifeCycleTaskManager.registerLifeCycleTask(new BackupLifeCycleTask());
}
```

---

## 5. Instance Config Extension

**Location:** `daemon/src/entity/instance/Instance_config.ts`

### Adding backupConfig

```typescript
export default class InstanceConfig implements IGlobalInstanceConfig {
  // Existing fields...
  
  public backupConfig = {
    enabled: false,
    providerId: "",
    selectedPaths: [] as string[],
    scheduledBackup: false,
    scheduleInterval: 360  // minutes (6 hours default)
  };
}
```

### Updating via parameters()

In `instance.ts` `parameters()` method:

```typescript
if (cfg.backupConfig) {
  configureEntityParams(this.config.backupConfig, cfg.backupConfig, "enabled", Boolean);
  configureEntityParams(this.config.backupConfig, cfg.backupConfig, "providerId", String);
  configureEntityParams(this.config.backupConfig, cfg.backupConfig, "selectedPaths");
  configureEntityParams(this.config.backupConfig, cfg.backupConfig, "scheduledBackup", Boolean);
  configureEntityParams(this.config.backupConfig, cfg.backupConfig, "scheduleInterval", Number);
  
  // Re-initialize lifecycle tasks if backup config changed
  if (this.isStoppedOrBusy()) {
    this.forceExec(new FunctionDispatcher());
  }
}
```

---

## 6. Preset Command Pattern

**Location:** `daemon/src/entity/commands/base/command.ts`

### Creating Backup Command

```typescript
import Instance from "../../instance/instance";
import InstanceCommand from "./base/command";

export default class BackupCommand extends InstanceCommand {
  constructor() {
    super("BackupCommand");
  }

  async exec(instance: Instance, param?: { selectedPaths?: string[] }): Promise<any> {
    if (instance.status() !== Instance.STATUS_STOP) {
      throw new Error("Instance must be stopped for backup");
    }
    
    // Trigger backup via BackupService
    // Return task ID for status tracking
  }

  async stop(instance: Instance): Promise<void> {
    // Cancel ongoing backup
  }
}
```

### Registering in FunctionDispatcher

```typescript
// In dispatcher.ts
instance.setPreset("backup", new BackupCommand());
```

---

## Summary: Implementation Checklist

Based on the deep dive, here's the implementation order with specific file modifications:

| Step | Component | Files to Modify/Create |
|------|-----------|------------------------|
| 1 | Provider Interface | `daemon/src/service/backup/providers/IStorageProvider.ts` [NEW] |
| 2 | S3 Provider | `daemon/src/service/backup/providers/S3StorageProvider.ts` [NEW] |
| 3 | GCS Provider | `daemon/src/service/backup/providers/GCSStorageProvider.ts` [NEW] |
| 4 | Global Config | `daemon/src/entity/config.ts` [MODIFY] |
| 5 | Instance Config | `daemon/src/entity/instance/Instance_config.ts` [MODIFY] |
| 6 | Instance Parameters | `daemon/src/entity/instance/instance.ts` [MODIFY] - `parameters()` |
| 7 | Backup Service | `daemon/src/service/backup/backup_service.ts` [NEW] |
| 8 | Backup Command | `daemon/src/entity/commands/general/backup_command.ts` [NEW] |
| 9 | Lifecycle Task | `daemon/src/entity/commands/task/backup_lifecycle.ts` [NEW] |
| 10 | FunctionDispatcher | `daemon/src/entity/commands/dispatcher.ts` [MODIFY] |
| 11 | Schedule Action | `daemon/src/service/system_instance_control.ts` [MODIFY] |
| 12 | Daemon Routers | `daemon/src/routers/backup_router.ts` [NEW] |
| 13 | Panel Proxy | `panel/src/app/routers/backup_router.ts` [NEW] |
| 14 | i18n | `languages/en_US.json` [MODIFY] |
