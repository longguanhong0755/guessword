import { handle } from "./_engine.js";

export function onRequest(context) {
  return handle(context, "new");
}
