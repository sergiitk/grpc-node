/*
 * Copyright 2019 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { CallCredentials } from '../src/call-credentials';
import { ChannelCredentials } from '../src/channel-credentials';
import * as grpc from '../src';
import { ServiceClient, ServiceClientConstructor } from '../src/make-client';

import { assert2, loadProtoFile, mockFunction } from './common';
import { sendUnaryData, ServerUnaryCall, ServiceError } from '../src';

const protoFile = path.join(__dirname, 'fixtures', 'echo_service.proto');
const echoService = loadProtoFile(protoFile)
  .EchoService as ServiceClientConstructor;

class CallCredentialsMock implements CallCredentials {
  child: CallCredentialsMock | null = null;
  constructor(child?: CallCredentialsMock) {
    if (child) {
      this.child = child;
    }
  }

  generateMetadata = mockFunction;

  compose(callCredentials: CallCredentialsMock): CallCredentialsMock {
    return new CallCredentialsMock(callCredentials);
  }

  _equals(other: CallCredentialsMock): boolean {
    if (!this.child) {
      return this === other;
    } else if (!other || !other.child) {
      return false;
    } else {
      return this.child._equals(other.child);
    }
  }
}

// tslint:disable-next-line:no-any
const readFile: (...args: any[]) => Promise<Buffer> = promisify(fs.readFile);
// A promise which resolves to loaded files in the form { ca, key, cert }
const pFixtures = Promise.all(
  ['ca.pem', 'server1.key', 'server1.pem'].map(file =>
    readFile(`${__dirname}/fixtures/${file}`)
  )
).then(result => {
  return { ca: result[0], key: result[1], cert: result[2] };
});

describe('ChannelCredentials Implementation', () => {
  describe('createSsl', () => {

    it('should throw if just one of private key and cert chain are missing', async () => {
      const { ca, key, cert } = await pFixtures;
      assert.throws(() => ChannelCredentials.createSsl(ca, key));
      assert.throws(() => ChannelCredentials.createSsl(ca, key, null));
      assert.throws(() => ChannelCredentials.createSsl(ca, null, cert));
      assert.throws(() => ChannelCredentials.createSsl(null, key));
      assert.throws(() => ChannelCredentials.createSsl(null, key, null));
      assert.throws(() => ChannelCredentials.createSsl(null, null, cert));
    });
  });

  describe('compose', () => {
    it('should return a ChannelCredentials object', () => {
      const channelCreds = ChannelCredentials.createSsl();
      const callCreds = new CallCredentialsMock();
      const composedChannelCreds = channelCreds.compose(callCreds);
      assert.strictEqual(composedChannelCreds._getCallCredentials(), callCreds);
    });

    it('should be chainable', () => {
      const callCreds1 = new CallCredentialsMock();
      const callCreds2 = new CallCredentialsMock();
      // Associate both call credentials with channelCreds
      const composedChannelCreds = ChannelCredentials.createSsl()
        .compose(callCreds1)
        .compose(callCreds2);
      // Build a mock object that should be an identical copy
      const composedCallCreds = callCreds1.compose(callCreds2);
      assert.ok(
        composedCallCreds._equals(
          composedChannelCreds._getCallCredentials() as CallCredentialsMock
        )
      );
    });
  });
});

describe('ChannelCredentials usage', () => {
  let client: ServiceClient;
  let server: grpc.Server;
  let portNum: number;
  let caCert: Buffer;
  const hostnameOverride = 'foo.test.google.fr';
  before(async () => {
    const { ca, key, cert } = await pFixtures;
    caCert = ca;
    const serverCreds = grpc.ServerCredentials.createSsl(null, [
      { private_key: key, cert_chain: cert },
    ]);
    const channelCreds = ChannelCredentials.createSsl(ca);
    const callCreds = CallCredentials.createFromMetadataGenerator(
      (options, cb) => {
        const metadata = new grpc.Metadata();
        metadata.set('test-key', 'test-value');
        cb(null, metadata);
      }
    );
    const combinedCreds = channelCreds.compose(callCreds);
    return new Promise<void>((resolve, reject) => {
      server = new grpc.Server();
      server.addService(echoService.service, {
        echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
          call.sendMetadata(call.metadata);
          callback(null, call.request);
        },
      });

      server.bindAsync('localhost:0', serverCreds, (err, port) => {
        if (err) {
          reject(err);
          return;
        }
        portNum = port;
        client = new echoService(`localhost:${port}`, combinedCreds, {
          'grpc.ssl_target_name_override': hostnameOverride,
          'grpc.default_authority': hostnameOverride,
        });
        server.start();
        resolve();
      });
    });
  });
  after(() => {
    server.forceShutdown();
  });

  it('Should send the metadata from call credentials attached to channel credentials', done => {
    const call = client.echo(
      { value: 'test value', value2: 3 },
      assert2.mustCall((error: ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: 'test value', value2: 3 });
      })
    );
    call.on(
      'metadata',
      assert2.mustCall((metadata: grpc.Metadata) => {
        assert.deepStrictEqual(metadata.get('test-key'), ['test-value']);
      })
    );
    assert2.afterMustCallsSatisfied(done);
  });

  it('Should call the checkServerIdentity callback', done => {
    const channelCreds = ChannelCredentials.createSsl(caCert, null, null, {
      checkServerIdentity: assert2.mustCall((hostname, cert) => {
        assert.strictEqual(hostname, hostnameOverride);
        return undefined;
      }),
    });
    const client = new echoService(`localhost:${portNum}`, channelCreds, {
      'grpc.ssl_target_name_override': hostnameOverride,
      'grpc.default_authority': hostnameOverride,
    });
    client.echo(
      { value: 'test value', value2: 3 },
      assert2.mustCall((error: ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: 'test value', value2: 3 });
      })
    );
    assert2.afterMustCallsSatisfied(done);
  });
});
