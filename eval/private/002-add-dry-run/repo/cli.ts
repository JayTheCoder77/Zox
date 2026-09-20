const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("usage: bun cli.ts process [--help]");
  process.exit(0);
}
await Bun.write("out.txt", "processed\n");
console.log("wrote out.txt");
