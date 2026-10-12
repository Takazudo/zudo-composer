// Each child owns its own connection and process. No state/lock is shared through JavaScript.
import { createHostedConformanceService } from "zudo-composer/hosted-content/testing";
import { openSqliteHandle } from "./sqlite-storage.mjs";

const [filename, identity] = process.argv.slice(2);
if (!filename || !identity || !process.send) throw new Error("SQLite worker requires a database, identity and IPC channel");
const handle = openSqliteHandle(filename);
const service = createHostedConformanceService(handle.storage, identity);
const actor = { id: "allowed-editor" };
let gate;
const respond = (id, result) => process.send({ id, result });
process.on("message", async message => {
  try {
    let result;
    switch (message.action) {
      case "read": result = await service.readState(actor); break;
      case "database": result = await handle.storage.read(); break;
      case "execute": result = await service.execute(actor, message.request); break;
      case "receipt": result = await service.readReceipt(actor, message.operationKey); break;
      case "snapshot": result = await service.readSnapshot(actor, message.snapshotId); break;
      case "publication": result = await service.getPublication(actor, message.publicationId); break;
      case "integration": result = await service.recordConfirmedIntegration(message.evidence); break;
      case "status": result = await service.recordStatus(message.evidence); break;
      case "fault": handle.faultNextTransaction(message.fault); result = true; break;
      case "hold":
        gate = handle.holdNextTransaction();
        void gate.entered.then(() => process.send({ event: "transaction-held" }));
        result = true; break;
      case "hold-commit":
        gate = handle.holdNextCommit();
        void gate.entered.then(() => process.send({ event: "commit-held" }));
        result = true; break;
      case "release": gate?.release(); result = true; break;
      case "close": handle.close(); respond(message.id, true); process.disconnect(); return;
      default: throw new Error(`Unknown fixture action ${message.action}`);
    }
    respond(message.id, result);
  } catch (error) {
    process.send({ id: message.id, error: { name: error.name, code: error.code, message: error.message,
      diagnostics: error.diagnostics } });
  }
});
process.send({ event: "ready", pid: process.pid });
