import { createApp } from "./app.js";
import { seedTemplates } from "./db.js";

const port = Number(process.env.PORT ?? 4000);

await seedTemplates();
createApp().listen(port, () => {
  console.log(`TxB API listening on ${port}`);
});
