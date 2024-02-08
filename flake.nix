{
  description = "Description for the project";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    aiken = {
      url = "github:aiken-lang/aiken/97acd6d";
    };
  };

  outputs = inputs@{ self, nixpkgs, flake-utils, aiken }:
    flake-utils.lib.eachDefaultSystem (system:
    let 
        overlay = final : prev: {
          aiken = inputs.aiken.packages.${system}.default;
          nodejs = prev.nodejs-18_x;
          pnpm = prev.nodePackages.pnpm;
        };
        pkgs = import nixpkgs { inherit system; overlays = [overlay ]; };
    in rec
      {
        devShells.default = pkgs.mkShell {
          packages = [ pkgs.nodejs pkgs.pnpm pkgs.aiken] ;
          shellHook = ''
            echo "Aiken Dev Environment"
            echo "Aiken Version: `${pkgs.aiken}/bin/aiken --version`"
            '';
        };
      }
    );

}
