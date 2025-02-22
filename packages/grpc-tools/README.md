# grpc-tools

This package distributes the Protocol Buffers compiler `protoc` along with the
plugin for generating client and service objects for use with the Node gRPC
libraries.

## Usage

This library exports the `grpc_tools_node_protoc` executable, which accepts all
of the same arguments as `protoc` itself. For use with Node, you most likely
want to use CommonJS-style imports. An example of generating code this way can
be found in [this guide](https://github.com/protocolbuffers/protobuf-javascript/blob/main/docs/index.md).
The `grpc_tools_node_protoc` automatically includes the Node gRPC plugin, so
it also accepts the `--grpc_out=[option:]path` argument. The option can be
one of the following:

 - `grpc_js`: Generates code with `require('@grpc/grpc-js')` instead of
   `require('grpc')`
 - `generate_package_definition`: Generates code that does not `require` any
   gRPC library, and instead generates `PackageDefinition` objects that can
   be passed to the `loadPackageDefinition` function provided by both the
   `grpc` and `@grpc/grpc-js` libraries.
 - `omit_serialize_instanceof`: Omit the `instanceof` check for messages in
   client code. This is useful when the message was renamed or is from a
   different package, and serialization would fail with
   `Expected argument of type …`.
