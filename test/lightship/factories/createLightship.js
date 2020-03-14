// @flow

import test from 'ava';
import sinon from 'sinon';
import delay from 'delay';
import axios from 'axios';
import createLightship from '../../../src/factories/createLightship';
import {
  SERVER_IS_NOT_READY,
  SERVER_IS_NOT_SHUTTING_DOWN,
  SERVER_IS_READY,
  SERVER_IS_SHUTTING_DOWN,
} from '../../../src/states';

type ProbeStateType = {|
  +message: string,
  +status: number,
|};

type ServiceStateType = {|
  +health: ProbeStateType,
  +live: ProbeStateType,
  +ready: ProbeStateType,
|};

const getServiceState = async (port: number = 9000): Promise<ServiceStateType> => {
  const health = await axios('http://127.0.0.1:' + port + '/health', {
    validateStatus: () => {
      return true;
    },
  });

  const live = await axios('http://127.0.0.1:' + port + '/live', {
    validateStatus: () => {
      return true;
    },
  });

  const ready = await axios('http://127.0.0.1:' + port + '/ready', {
    validateStatus: () => {
      return true;
    },
  });

  return {
    health: {
      message: health.data,
      status: health.status,
    },
    live: {
      message: live.data,
      status: live.status,
    },
    ready: {
      message: ready.data,
      status: ready.status,
    },
  };
};

test('server starts in SERVER_IS_NOT_READY state', async (t) => {
  const terminate = sinon.stub();

  const lightship = createLightship({
    terminate,
  });

  t.is(lightship.isServerReady(), false);
  t.is(lightship.isServerShuttingDown(), false);

  const serviceState = await getServiceState(lightship.server.address().port);

  t.is(serviceState.health.status, 500);
  t.is(serviceState.health.message, SERVER_IS_NOT_READY);

  t.is(serviceState.live.status, 200);
  t.is(serviceState.live.message, SERVER_IS_NOT_SHUTTING_DOWN);

  t.is(serviceState.ready.status, 500);
  t.is(serviceState.ready.message, SERVER_IS_NOT_READY);

  await lightship.shutdown();

  t.is(terminate.called, false);
});

test('calling `signalReady` changes server state to SERVER_IS_READY', async (t) => {
  const terminate = sinon.stub();

  const lightship = createLightship({
    terminate,
  });

  lightship.signalReady();

  t.is(lightship.isServerReady(), true);
  t.is(lightship.isServerShuttingDown(), false);

  const serviceState = await getServiceState(lightship.server.address().port);

  t.is(serviceState.health.status, 200);
  t.is(serviceState.health.message, SERVER_IS_READY);

  t.is(serviceState.live.status, 200);
  t.is(serviceState.live.message, SERVER_IS_NOT_SHUTTING_DOWN);

  t.is(serviceState.ready.status, 200);
  t.is(serviceState.ready.message, SERVER_IS_READY);

  await lightship.shutdown();

  t.is(terminate.called, false);
});

test('calling `signalNotReady` changes server state to SERVER_IS_NOT_READY', async (t) => {
  const terminate = sinon.stub();

  const lightship = createLightship({
    terminate,
  });

  lightship.signalReady();
  lightship.signalNotReady();

  t.is(lightship.isServerReady(), false);
  t.is(lightship.isServerShuttingDown(), false);

  const serviceState = await getServiceState(lightship.server.address().port);

  t.is(serviceState.health.status, 500);
  t.is(serviceState.health.message, SERVER_IS_NOT_READY);

  t.is(serviceState.live.status, 200);
  t.is(serviceState.live.message, SERVER_IS_NOT_SHUTTING_DOWN);

  t.is(serviceState.ready.status, 500);
  t.is(serviceState.ready.message, SERVER_IS_NOT_READY);

  await lightship.shutdown();

  t.is(terminate.called, false);
});

test('calling `shutdown` changes server state to SERVER_IS_SHUTTING_DOWN', async (t) => {
  const terminate = sinon.stub();

  const lightship = createLightship({
    terminate,
  });

  let shutdown;

  lightship.registerShutdownHandler(() => {
    return new Promise((resolve) => {
      shutdown = resolve;
    });
  });

  lightship.shutdown();

  t.is(lightship.isServerReady(), true);
  t.is(lightship.isServerShuttingDown(), true);

  const serviceState = await getServiceState(lightship.server.address().port);

  t.is(serviceState.health.status, 500);
  t.is(serviceState.health.message, SERVER_IS_SHUTTING_DOWN);

  t.is(serviceState.live.status, 500);
  t.is(serviceState.live.message, SERVER_IS_SHUTTING_DOWN);

  // @see https://github.com/gajus/lightship/issues/12
  t.is(serviceState.ready.status, 200);
  t.is(serviceState.ready.message, SERVER_IS_READY);

  if (!shutdown) {
    throw new Error('Unexpected state.');
  }

  await shutdown();

  t.is(terminate.called, false);
});

test('calling `shutdown` respecting `kubeProxyTimeout` value', async (t) => {
  const terminate = sinon.stub();

  const lightship = createLightship({
    kubeProxyTimeout: 1000,
    terminate,
  });

  let shutdown;

  lightship.registerShutdownHandler(() => {
    return new Promise((resolve) => {
      shutdown = resolve;
    });
  });

  lightship.shutdown();

  t.is(lightship.isServerReady(), false);
  t.is(lightship.isServerShuttingDown(), false);

  await delay(1000);

  t.is(lightship.isServerReady(), true);
  t.is(lightship.isServerShuttingDown(), true);

  const serviceState = await getServiceState(lightship.server.address().port);

  t.is(serviceState.health.status, 500);
  t.is(serviceState.health.message, SERVER_IS_SHUTTING_DOWN);

  t.is(serviceState.live.status, 500);
  t.is(serviceState.live.message, SERVER_IS_SHUTTING_DOWN);

  // @see https://github.com/gajus/lightship/issues/12
  t.is(serviceState.ready.status, 200);
  t.is(serviceState.ready.message, SERVER_IS_READY);

  if (!shutdown) {
    throw new Error('Unexpected state.');
  }

  await shutdown();

  t.is(terminate.called, false);
});

test('error thrown from within a shutdown handler does not interrupt the shutdown sequence', async (t) => {
  const terminate = sinon.stub();

  const lightship = createLightship({
    terminate,
  });

  const shutdownHandler0 = sinon.spy(async () => {
    throw new Error('test');
  });

  let shutdown;

  const shutdownHandler1 = sinon.spy(() => {
    return new Promise((resolve) => {
      shutdown = resolve;
    });
  });

  lightship.registerShutdownHandler(shutdownHandler0);
  lightship.registerShutdownHandler(shutdownHandler1);

  lightship.shutdown();

  await delay(500);

  if (!shutdown) {
    throw new Error('Unexpected state.');
  }

  await shutdown();

  t.is(shutdownHandler0.callCount, 1);
  t.is(shutdownHandler1.callCount, 1);

  t.is(terminate.called, false);
});

test('calling `shutdown` multiple times results in shutdown handlers called once', async (t) => {
  const terminate = sinon.stub();

  const lightship = createLightship({
    terminate,
  });

  let shutdown;

  const shutdownHandler = sinon.spy(() => {
    return new Promise((resolve) => {
      shutdown = resolve;
    });
  });

  lightship.registerShutdownHandler(shutdownHandler);

  t.is(shutdownHandler.callCount, 0);

  lightship.shutdown();

  t.is(shutdownHandler.callCount, 1);

  lightship.shutdown();

  t.is(shutdownHandler.callCount, 1);

  if (!shutdown) {
    throw new Error('Unexpected state.');
  }

  await shutdown();

  t.is(terminate.called, false);
});

test('calling `signalNotReady` after `shutdown` does not have effect on server state', async (t) => {
  const terminate = sinon.stub();

  const lightship = createLightship({
    terminate,
  });

  let shutdown;

  lightship.registerShutdownHandler(() => {
    return new Promise((resolve) => {
      shutdown = resolve;
    });
  });

  lightship.signalReady();

  t.is(lightship.isServerReady(), true);
  t.is(lightship.isServerShuttingDown(), false);

  const serviceState0 = await getServiceState(lightship.server.address().port);

  t.is(serviceState0.health.status, 200);
  t.is(serviceState0.health.message, SERVER_IS_READY);

  lightship.shutdown();

  t.is(lightship.isServerReady(), true);
  t.is(lightship.isServerShuttingDown(), true);

  const serviceState1 = await getServiceState(lightship.server.address().port);

  t.is(serviceState1.health.status, 500);
  t.is(serviceState1.health.message, SERVER_IS_SHUTTING_DOWN);

  lightship.signalNotReady();

  t.is(lightship.isServerReady(), true);
  t.is(lightship.isServerShuttingDown(), true);

  const serviceState2 = await getServiceState(lightship.server.address().port);

  t.is(serviceState2.health.status, 500);
  t.is(serviceState2.health.message, SERVER_IS_SHUTTING_DOWN);

  if (!shutdown) {
    throw new Error('Unexpected state.');
  }

  await shutdown();

  t.is(terminate.called, false);
});

test('presence of live beacons suspend the shutdown routine', async (t) => {
  const terminate = sinon.stub();

  const lightship = createLightship({
    terminate,
  });

  let shutdown;

  const shutdownHandler = sinon.spy(() => {
    return new Promise((resolve) => {
      shutdown = resolve;
    });
  });

  lightship.registerShutdownHandler(shutdownHandler);

  const beacon = lightship.createBeacon();

  t.is(shutdownHandler.callCount, 0);

  lightship.shutdown();

  t.is(shutdownHandler.callCount, 0);

  await beacon.die();

  t.is(shutdownHandler.callCount, 1);

  if (!shutdown) {
    throw new Error('Unexpected state.');
  }

  await shutdown();

  t.is(terminate.called, false);
});
