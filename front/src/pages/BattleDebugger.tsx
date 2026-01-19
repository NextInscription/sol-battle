import { useState, useEffect } from 'react';

type DebugItem = {
  index: number;
  pubkey: string;
  dataLength: number;
  offsets: Record<string, string>;
  betAmounts: {
    'offset 49': bigint;
    'offset 50': bigint;
    'offset 81': bigint;
    'offset 82': bigint;
    in: {
      SOL: {
        '49': number;
        '50': number;
        '81': number;
        '82': number;
      };
    };
  };
};

export default function BattleDebugger() {
  const [debugInfo, setDebugInfo] = useState<DebugItem[]>([]);

  const testParsing = async () => {
    try {
      const response = await fetch('http://localhost:8899', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getProgramAccounts',
          params: [
            'FzPt8DvFfzG9GUA56Yp22DCPgj8qgm6McCVRKoVYyADK',
            { encoding: 'base64' }
          ]
        })
      });
      const result = await response.json();
      const accounts = result.result;

      const battles = accounts.filter((acc: any) => {
        const data = Buffer.from(acc.account.data[0], 'base64');
        return data.length === 314;
      });

      const debugData = battles.map((acc: any, index: number) => {
        const data = Buffer.from(acc.account.data[0], 'base64');

        // 尝试不同的偏移量
        const offsets: Record<string, string> = {
          '0-119': data.subarray(0, 120).toString('hex'),
          '8-15 (battle_id)': data.subarray(8, 16).toString('hex'),
          '16-47 (creator)': data.subarray(16, 48).toString('hex'),
          '48-80 (challenger)': data.subarray(48, 81).toString('hex'),
          '49-56 (bet_amount???)': data.subarray(49, 57).toString('hex'),
          '50-57 (bet_amount???)': data.subarray(50, 58).toString('hex'),
          '81-88 (bet_amount?)': data.subarray(81, 89).toString('hex'),
          '89-96 (commit_creator)': data.subarray(89, 121).toString('hex'),
          '255-262 (created_at_slot?)': data.subarray(255, 263).toString('hex'),
        };

        // 尝试读取 bet_amount 在不同位置
        const betAt49 = data.readBigUInt64LE(49);
        const betAt50 = data.readBigUInt64LE(50);
        const betAt81 = data.readBigUInt64LE(81);
        const betAt82 = data.readBigUInt64LE(82);

        return {
          index,
          pubkey: acc.pubkey,
          dataLength: data.length,
          offsets,
          betAmounts: {
            'offset 49': betAt49,
            'offset 50': betAt50,
            'offset 81': betAt81,
            'offset 82': betAt82,
            in: {
              SOL: {
                '49': Number(betAt49) / 1e9,
                '50': Number(betAt50) / 1e9,
                '81': Number(betAt81) / 1e9,
                '82': Number(betAt82) / 1e9,
              }
            }
          }
        };
      });

      setDebugInfo(debugData);
    } catch (error) {
      console.error('Failed to fetch:', error);
    }
  };

  useEffect(() => {
    testParsing();
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Battle Data Debugger</h1>
      <button onClick={testParsing}>Refresh</button>
      <div style={{ marginTop: '20px' }}>
        {debugInfo.map((item) => (
          <div key={item.index} style={{ marginBottom: '40px', border: '1px solid #333', padding: '10px' }}>
            <h3>Battle #{item.index} - {item.pubkey.substring(0, 8)}</h3>
            <p><strong>Data length:</strong> {item.dataLength} bytes</p>

            <h4>Bet Amount Tests:</h4>
            <pre>
offset 49: {item.betAmounts['offset 49']} lamports = {item.betAmounts.in.SOL['49']} SOL
offset 50: {item.betAmounts['offset 50']} lamports = {item.betAmounts.in.SOL['50']} SOL
offset 81: {item.betAmounts['offset 81']} lamports = {item.betAmounts.in.SOL['81']} SOL
offset 82: {item.betAmounts['offset 82']} lamports = {item.betAmounts.in.SOL['82']} SOL
            </pre>

            <h4>Key Offsets:</h4>
            {Object.entries(item.offsets).map(([key, value]) => (
              <div key={key}>
                <strong>{key}:</strong>
                <pre style={{ fontSize: '12px' }}>{value}</pre>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
