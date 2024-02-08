
{ pkgs ? import <nixpkgs> {} }:
let
  unstable = import <unstable> {};
in
pkgs.mkShell {
  nativeBuildInputs = [
    unstable.deno
  ];
}