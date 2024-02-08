import * as fs from "fs";
import { C, Data, toHex } from "translucent-cardano";
import { sign } from "noble-ed25519";

type OracleOptions = { readFromFile: string } | "NewKey";
export class Oracle {
  private privateKey: string;
  publicKey: string;
  constructor(options: OracleOptions) {
    if (options == "NewKey") {
      const privateKey = C.PrivateKey.generate_ed25519();
      this.privateKey = toHex(privateKey.as_bytes());
      const pubKey = privateKey.to_public();
      this.publicKey = toHex(pubKey.as_bytes());
      pubKey.free();
      privateKey.free();
    } else {
      const privateKey = C.PrivateKey.from_bech32(
        fs.readFileSync(options.readFromFile, "utf8")
      );
      this.privateKey = toHex(privateKey.as_bytes());
      const pubKey = privateKey.to_public();
      this.publicKey = toHex(pubKey.as_bytes());
      pubKey.free();
      privateKey.free();
    }
  }

  async signFeed(payload: string) {
    const signature = await sign(payload, this.privateKey);
    return {
      data: payload,
      signature,
    };
  }
}
