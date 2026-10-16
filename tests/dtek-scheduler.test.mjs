import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchDtekPublisher} from '../src/dtek-scheduler.js';

const logs={log(){},warn(){}};

test('if no Cloudflare secret, never send unauthenticated GitHub requests',async()=>{
  let touched=false;
  const result=await dispatchDtekPublisher({},{
    logger:logs,fetchFn:async()=>{touched=true;throw Error('should not fetch')}
  });
  assert.equal(result.status,'not-configured');
  assert.equal(touched,false);
});

test('only dispatch DTEK GitHub Actions on main with bearer secret',async()=>{
  let requests=0;
  const result=await dispatchDtekPublisher({DTEK_GITHUB_TOKEN:'example-test-token'},{
    logger:logs,
    fetchFn:async (url,opts)=>{
      requests++;
      assert.equal(url,'https://api.github.com/repos/XOTT69/dtek/actions/workflows/publish.yml/dispatches');
      assert.equal(opts.method,'POST');
      assert.equal(opts.headers.Authorization,'Bearer example-test-token');
      assert.equal(JSON.parse(opts.body).ref,'main');
      return {status:204};
    }
  });
  assert.equal(requests,1);
  assert.equal(result.status,'dispatched');
});

test('GitHub authorization failures do not crash water bot cron',async()=>{
  const lines=[];
  const status=await dispatchDtekPublisher({DTEK_GITHUB_TOKEN:'secret-not-for-logs'},{
    logger:{log:m=>lines.push(m),warn:m=>lines.push(m)},
    fetchFn:async()=>({status:403})
  });
  assert.equal(status.status,'rejected');
  assert.equal(status.code,403);
  assert.doesNotMatch(lines.join(' '),/secret-not-for-logs/);
});

test('network outage is reported safely with no token in logs',async()=>{
  const lines=[];
  const status=await dispatchDtekPublisher({DTEK_GITHUB_TOKEN:'never-log-token'},{
    logger:{log:m=>lines.push(m),warn:m=>lines.push(m)},
    fetchFn:async()=>{throw new Error('request failed with secret never-log-token')}
  });
  assert.equal(status.status,'network-error');
  assert.doesNotMatch(lines.join(' '),/never-log-token/);
});
