# MCSManager Codebase Standards

Reference document for implementing the backup module consistently with existing code patterns.

---

## TypeScript Configuration

- **Target**: ES2018
- **Module**: CommonJS
- **Strict mode**: Enabled (`strict: true`, `strictNullChecks`, `noImplicitAny`)
- **Path aliases**: `@languages/*` → `../languages/*`

---

## Daemon Patterns

### Router (WebSocket Events)

```typescript
// daemon/src/routers/xxx_router.ts
import { routerApp } from "../service/router";
import * as protocol from "../service/protocol";
import { $t } from "../i18n";

// Middleware (optional)
routerApp.use((event, ctx, data, next) => {
  if (event.startsWith("backup/")) {
    // validation logic
  }
  next();
});

// Event handler
routerApp.on("backup/create", async (ctx, data) => {
  try {
    // business logic
    protocol.response(ctx, result);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
```

**Registration**: Import router file in `daemon/src/service/router.ts`

### Protocol Response Helpers

```typescript
import * as protocol from "../service/protocol";

protocol.response(ctx, data);           // Success response
protocol.responseError(ctx, error);     // Error response
protocol.msg(ctx, "event/name", data);  // Send to specific event
protocol.error(ctx, "event/name", err); // Error to specific event
```

### Services (Singleton Pattern)

```typescript
// daemon/src/service/xxx_service.ts
class MyService {
  constructor() { /* init */ }
  
  public methodName() { /* logic */ }
}

export default new MyService();
```

### AsyncTask (Long-running Operations)

```typescript
import { AsyncTask, TaskCenter } from "../service/async_task_service";

class BackupTask extends AsyncTask {
  public static TYPE = "BackupTask";
  
  constructor() {
    super();
    this.taskId = `BackupTask-${uuid}`;
    this.type = BackupTask.TYPE;
  }
  
  async onStart(): Promise<void> { /* main logic */ }
  async onStop(): Promise<void> { /* cleanup */ }
  async onError(err: Error): Promise<void> { /* error handling */ }
  toObject(): IAsyncTaskJSON { /* status object */ }
}

// Usage
const task = new BackupTask();
TaskCenter.addTask(task);
```

### LifeCycle Task (Instance Start/Stop Hooks)

```typescript
import { ILifeCycleTask } from "../../entity/instance/life_cycle";
import Instance from "../../entity/instance/instance";

export default class BackupLifeCycleTask implements ILifeCycleTask {
  public status: number = 0;
  public name: string = "BackupLifeCycleTask";
  private task: NodeJS.Timeout | null = null;

  async start(instance: Instance) {
    // Called when instance starts
  }

  async stop(instance: Instance) {
    // Called when instance stops
  }
}
```

### Command (Preset Actions)

```typescript
import Instance from "../../instance/instance";
import InstanceCommand from "./base/command";

export default class BackupCommand extends InstanceCommand {
  constructor() {
    super("BackupCommand");
  }

  async exec(instance: Instance, param?: any): Promise<any> {
    // Execute backup
  }

  async stop(instance: Instance) {
    // Cancel backup
  }
}
```

### Storage/Persistence

```typescript
import StorageSubsystem from "../common/system_storage";

// Store
StorageSubsystem.store("Category", "uniqueId", dataObject);

// Load
const data = StorageSubsystem.load("Category", EntityClass, "uniqueId");

// Delete
StorageSubsystem.delete("Category", "uniqueId");

// List all IDs
const ids = StorageSubsystem.list("Category");
```

---

## Panel Patterns

### Router (REST API)

```typescript
// panel/src/app/routers/xxx_router.ts
import Router from "@koa/router";
import permission from "../middleware/permission";
import validator from "../middleware/validator";
import { ROLE } from "../entity/user";
import RemoteRequest from "../service/remote_command";
import RemoteServiceSubsystem from "../service/remote_service";

const router = new Router({ prefix: "/protected_instance" });

// Permission middleware (per-route)
router.use(async (ctx, next) => {
  // check instance access
  await next();
});

router.post(
  "/backup",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
      const result = await new RemoteRequest(remoteService).request(
        "backup/create",
        { instanceUuid }
      );
      ctx.body = result;
    } catch (err) {
      ctx.body = err;
    }
  }
);

export default router;
```

**Registration**: Import and mount in `panel/src/app/index.ts`

---

## i18n (Internationalization)

```typescript
import { $t } from "../i18n";

// Simple translation
throw new Error($t("TXT_CODE_backup.errorMessage"));

// With parameters
logger.info($t("TXT_CODE_backup.started", { instanceUuid: uuid }));
```

**Translation file**: `languages/en_US.json`
```json
{
  "TXT_CODE_backup.errorMessage": "Backup failed",
  "TXT_CODE_backup.started": "Backup started for {{instanceUuid}}"
}
```

---

## Logging

```typescript
import logger from "../service/log";

logger.info("Informational message");
logger.warn("Warning message");
logger.error("Error message", error);
```

---

## File Compression

```typescript
import { compress, decompress } from "../common/compress";

// Compress files to zip
await compress("/path/to/archive.zip", ["file1.txt", "folder/"], "utf-8");

// Decompress
await decompress("/path/to/archive.zip", "/dest/dir/", "utf-8");
```

**Note**: Uses external Go binary (`GOLANG_ZIP_PATH`) for performance.

---

## Configuration Entities

```typescript
// Instance config extension pattern
public backupConfig = {
  enabled: false,
  providerId: "",
  selectedPaths: [] as string[],
  scheduledBackup: false,
  scheduleInterval: 360
};

// Use configureEntityParams for updates
import { configureEntityParams } from "mcsmanager-common";
configureEntityParams(this.config.backupConfig, cfg.backupConfig, "enabled", Boolean);
```

---

## Error Handling

```typescript
// Custom error class pattern
class BackupError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

// Async/await with try-catch
try {
  await someAsyncOperation();
} catch (error: any) {
  logger.error("Operation failed:", error);
  throw error; // or handle gracefully
}
```

---

## Dependencies to Add

For backup module:
```json
{
  "@aws-sdk/client-s3": "^3.x",
  "@aws-sdk/lib-storage": "^3.x",
  "@google-cloud/storage": "^7.x"
}
```

Install in `daemon/` directory only.

---

## File Naming Conventions

- Routers: `xxx_router.ts` (snake_case)
- Services: `xxx_service.ts` or `xxx.ts`
- Commands: `xxx_command.ts` or `general_xxx.ts`
- Tasks: Descriptive name matching class
- All lowercase with underscores
