import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';

/* ── Built-in examples (inline to avoid depending on converter package in browser) ── */

const EXAMPLES = {
  erc20: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleToken {
    string public name = "SimpleToken";
    string public symbol = "STK";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(uint256 _initialSupply) {
        owner = msg.sender;
        totalSupply = _initialSupply;
        balances[msg.sender] = _initialSupply;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balances[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Allowance exceeded");
        allowance[from][msg.sender] -= amount;
        balances[from] -= amount;
        balances[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function mint(uint256 amount) public onlyOwner {
        totalSupply += amount;
        balances[owner] += amount;
        emit Transfer(address(0), owner, amount);
    }

    function transferOwnership(address newOwner) public onlyOwner {
        owner = newOwner;
    }
}`,

  escrow: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Escrow {
    address public depositor;
    address public beneficiary;
    address public arbiter;
    uint256 public amount;
    bool public isReleased;
    bool public isRefunded;
    uint256 public deadline;

    event Deposited(address indexed depositor, uint256 amount);
    event Released(address indexed beneficiary, uint256 amount);
    event Refunded(address indexed depositor, uint256 amount);

    constructor(address _beneficiary, address _arbiter, uint256 _deadline) {
        depositor = msg.sender;
        beneficiary = _beneficiary;
        arbiter = _arbiter;
        deadline = _deadline;
    }

    function deposit() public payable {
        require(msg.sender == depositor, "Only depositor");
        require(msg.value > 0, "Must deposit something");
        amount += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function release() public {
        require(msg.sender == arbiter || msg.sender == depositor, "Not authorized");
        require(!isReleased && !isRefunded, "Already settled");
        require(amount > 0, "Nothing to release");
        isReleased = true;
        payable(beneficiary).transfer(amount);
        emit Released(beneficiary, amount);
    }

    function refund() public {
        require(block.timestamp >= deadline, "Deadline not reached");
        require(msg.sender == depositor || msg.sender == arbiter, "Not authorized");
        require(!isReleased && !isRefunded, "Already settled");
        isRefunded = true;
        payable(depositor).transfer(amount);
        emit Refunded(depositor, amount);
    }

    function withdraw() public {
        require(msg.sender == depositor, "Only depositor");
        require(!isReleased, "Already released");
        require(block.timestamp >= deadline, "Deadline not reached");
        isRefunded = true;
        payable(depositor).transfer(amount);
        emit Refunded(depositor, amount);
    }
}`,

  lending: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleLending {
    struct Loan {
        address borrower;
        uint256 collateral;
        uint256 principal;
        uint256 interestRate;
        bool active;
    }

    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId;
    uint256 public totalLiquidity;

    address public owner;

    event Borrowed(uint256 indexed loanId, address indexed borrower, uint256 amount);
    event Repaid(uint256 indexed loanId, address indexed borrower);
    event Liquidated(uint256 indexed loanId, address indexed liquidator);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function provideLiquidity() public payable {
        totalLiquidity += msg.value;
    }

    function borrow(uint256 amount) public payable {
        uint256 collateralRequired = (amount * 150) / 100;
        require(msg.value >= collateralRequired, "Insufficient collateral");
        require(totalLiquidity >= amount, "Insufficient liquidity");

        uint256 loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            collateral: msg.value,
            principal: amount,
            interestRate: 5,
            active: true
        });

        totalLiquidity -= amount;
        payable(msg.sender).transfer(amount);
        emit Borrowed(loanId, msg.sender, amount);
    }

    function repay(uint256 loanId) public payable {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan not active");
        require(msg.sender == loan.borrower, "Not borrower");

        uint256 repayAmount = loan.principal + (loan.principal * loan.interestRate / 100);
        require(msg.value >= repayAmount, "Insufficient repayment");

        loan.active = false;
        totalLiquidity += msg.value;
        payable(loan.borrower).transfer(loan.collateral);
        emit Repaid(loanId, msg.sender);
    }

    function liquidate(uint256 loanId) public {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan not active");
        loan.active = false;
        totalLiquidity += loan.collateral;
        emit Liquidated(loanId, msg.sender);
    }
}`,
};

/* ── Types ── */

interface ConversionOutput {
  mappingMarkdown: string;
  flowsMarkdown: string;
  diagramMarkdown: string;
  checklistMarkdown: string;
  aikenCode: string;
  aikenValidation: {
    isValid: boolean;
    score: number;
    errors: string[];
    warnings: string[];
    summary: string;
    suggestions: string[];
  };
  warnings: string[];
  meta: {
    detectedPatterns: string[];
    confidence: number;
  };
}

type InputTab = 'solidity' | 'abi' | 'description';
type OutputTab = 'mapping' | 'flows' | 'diagram' | 'checklist' | 'aiken' | 'warnings';

/* ── Component ── */

export default function App() {
  // Input state
  const [inputTab, setInputTab] = useState<InputTab>('solidity');
  const [solidityInput, setSolidityInput] = useState('');
  const [abiInput, setAbiInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');

  // Output state
  const [outputTab, setOutputTab] = useState<OutputTab>('mapping');
  const [output, setOutput] = useState<ConversionOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Actions ── */

  const handleConvert = useCallback(async () => {
    setLoading(true);
    setError(null);

    let abi: unknown = undefined;
    if (abiInput.trim()) {
      try {
        abi = JSON.parse(abiInput);
      } catch {
        setError('Invalid ABI JSON');
        setLoading(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solidity: solidityInput || undefined,
          abi: abi || undefined,
          description: descriptionInput || undefined,
          options: {
            target: 'cardano-eutxo',
            detailLevel: 'medium',
            assumptions: { useNFTState: true, useIndexers: true },
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data: ConversionOutput = await res.json();
      setOutput(data);
      setOutputTab('mapping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setLoading(false);
    }
  }, [solidityInput, abiInput, descriptionInput]);

  const loadExample = useCallback((key: keyof typeof EXAMPLES) => {
    setSolidityInput(EXAMPLES[key]);
    setInputTab('solidity');
  }, []);

  const copyCurrentTab = useCallback(() => {
    if (!output) return;
    const text = getOutputContent(output, outputTab);
    navigator.clipboard.writeText(text);
  }, [output, outputTab]);

  const downloadReport = useCallback(() => {
    if (!output) return;
    const sections = [
      output.mappingMarkdown,
      output.flowsMarkdown,
      output.diagramMarkdown,
      output.checklistMarkdown,
      '# Warnings\n\n' + output.warnings.map((w) => `- ${w}`).join('\n'),
    ];
    const markdown = sections.join('\n\n---\n\n');
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eutxo-architecture-report.md';
    a.click();
    URL.revokeObjectURL(url);
  }, [output]);

  /* ── Render ── */

  return (
    <>
      <header className="app-header">
        <h1>EVM → eUTXO Converter</h1>
        <span className="subtitle">
          Convert Solidity contracts to Cardano eUTXO architecture plans
        </span>
      </header>

      <div className="main-layout">
        {/* ── Left panel: Input ── */}
        <div className="panel">
          <div className="tabs">
            <button
              className={`tab ${inputTab === 'solidity' ? 'active' : ''}`}
              onClick={() => setInputTab('solidity')}
            >
              Solidity
            </button>
            <button
              className={`tab ${inputTab === 'abi' ? 'active' : ''}`}
              onClick={() => setInputTab('abi')}
            >
              ABI (JSON)
            </button>
            <button
              className={`tab ${inputTab === 'description' ? 'active' : ''}`}
              onClick={() => setInputTab('description')}
            >
              Text Description
            </button>
          </div>

          <div className="editor-area">
            {inputTab === 'solidity' && (
              <textarea
                value={solidityInput}
                onChange={(e) => setSolidityInput(e.target.value)}
                placeholder="Paste Solidity code here..."
                data-testid="solidity-input"
              />
            )}
            {inputTab === 'abi' && (
              <textarea
                value={abiInput}
                onChange={(e) => setAbiInput(e.target.value)}
                placeholder="Paste ABI JSON here..."
                data-testid="abi-input"
              />
            )}
            {inputTab === 'description' && (
              <textarea
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                placeholder="Describe your EVM architecture..."
                data-testid="description-input"
              />
            )}
          </div>

          <div className="button-bar">
            <button
              className="btn btn-primary"
              onClick={handleConvert}
              disabled={loading}
              data-testid="convert-btn"
            >
              {loading ? 'Converting...' : 'Convert'}
            </button>
            <button className="btn" onClick={() => loadExample('erc20')} data-testid="load-erc20">
              Load: ERC20
            </button>
            <button className="btn" onClick={() => loadExample('escrow')} data-testid="load-escrow">
              Load: Escrow
            </button>
            <button className="btn" onClick={() => loadExample('lending')} data-testid="load-lending">
              Load: Lending
            </button>
          </div>
        </div>

        {/* ── Right panel: Output ── */}
        <div className="panel">
          <div className="tabs">
            <button
              className={`tab ${outputTab === 'mapping' ? 'active' : ''}`}
              onClick={() => setOutputTab('mapping')}
            >
              Architecture Mapping
            </button>
            <button
              className={`tab ${outputTab === 'flows' ? 'active' : ''}`}
              onClick={() => setOutputTab('flows')}
            >
              Transaction Flows
            </button>
            <button
              className={`tab ${outputTab === 'diagram' ? 'active' : ''}`}
              onClick={() => setOutputTab('diagram')}
            >
              Component Diagram
            </button>
            <button
              className={`tab ${outputTab === 'checklist' ? 'active' : ''}`}
              onClick={() => setOutputTab('checklist')}
            >
              Checklist
            </button>
            <button
              className={`tab ${outputTab === 'aiken' ? 'active' : ''}`}
              onClick={() => setOutputTab('aiken')}
            >
              Aiken Code
            </button>
            <button
              className={`tab ${outputTab === 'warnings' ? 'active' : ''}`}
              onClick={() => setOutputTab('warnings')}
            >
              Warnings
              {output && output.warnings.length > 0 && (
                <span style={{ marginLeft: 6, color: 'var(--warning)' }}>
                  ({output.warnings.length})
                </span>
              )}
            </button>
          </div>

          <div className="output-area">
            {error && (
              <div className="warning-item" style={{ borderColor: 'var(--danger)' }}>
                Error: {error}
              </div>
            )}

            {loading && <div className="loading">Converting...</div>}

            {!loading && !output && !error && (
              <div className="empty-state">
                Paste Solidity code or load an example, then click Convert.
              </div>
            )}

            {!loading && output && outputTab === 'warnings' && (
              <div>
                {output.warnings.length === 0 ? (
                  <div className="empty-state">No warnings.</div>
                ) : (
                  output.warnings.map((w, i) => (
                    <div key={i} className="warning-item">
                      {w}
                    </div>
                  ))
                )}
              </div>
            )}

            {!loading && output && outputTab === 'aiken' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Validation Box */}
                <div
                  style={{
                    padding: 12,
                    borderRadius: 'var(--radius)',
                    backgroundColor: output.aikenValidation.isValid ? 'rgba(0, 206, 201, 0.1)' : 'rgba(255, 118, 117, 0.1)',
                    borderLeft: `4px solid ${output.aikenValidation.isValid ? 'var(--success)' : 'var(--danger)'}`,
                    fontSize: '13px',
                    lineHeight: '1.6',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    {output.aikenValidation.isValid ? '✅ ' : '❌ '}
                    Code Quality: {output.aikenValidation.score}/100
                  </div>
                  
                  {output.aikenValidation.errors.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ color: 'var(--danger)', fontWeight: 500 }}>
                        Errors ({output.aikenValidation.errors.length}):
                      </div>
                      {output.aikenValidation.errors.map((err, i) => (
                        <div key={i} style={{ marginLeft: 16, color: 'var(--text-muted)' }}>
                          • {err}
                        </div>
                      ))}
                    </div>
                  )}

                  {output.aikenValidation.warnings.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ color: 'var(--warning)', fontWeight: 500 }}>
                        Warnings ({output.aikenValidation.warnings.length}):
                      </div>
                      {output.aikenValidation.warnings.map((warn, i) => (
                        <div key={i} style={{ marginLeft: 16, color: 'var(--text-muted)' }}>
                          • {warn}
                        </div>
                      ))}
                    </div>
                  )}

                  {output.aikenValidation.suggestions.length > 0 && (
                    <div>
                      <div style={{ color: 'var(--accent)', fontWeight: 500 }}>
                        Suggestions:
                      </div>
                      {output.aikenValidation.suggestions.map((sugg, i) => (
                        <div key={i} style={{ marginLeft: 16, color: 'var(--text-muted)' }}>
                          • {sugg}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Code Display */}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>
                    Generated Aiken Validator:
                  </div>
                  <pre
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      padding: 12,
                      borderRadius: 'var(--radius)',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      overflowX: 'auto',
                      color: 'var(--text)',
                      lineHeight: '1.5',
                      border: `1px solid ${output.aikenValidation.isValid ? 'var(--success)' : 'var(--danger)'}`,
                    }}
                  >
                    {output.aikenCode}
                  </pre>
                </div>

                {/* Info Box */}
                {!output.aikenValidation.isValid && (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 'var(--radius)',
                      backgroundColor: 'rgba(255, 118, 117, 0.1)',
                      borderLeft: '4px solid var(--danger)',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    ⚠️ This code has errors that must be fixed before compilation. See validation details above.
                  </div>
                )}
              </div>
            )}

            {!loading && output && outputTab !== 'warnings' && outputTab !== 'aiken' && (
              <div className="markdown-content">
                <ReactMarkdown>{getOutputContent(output, outputTab)}</ReactMarkdown>
              </div>
            )}

            {output && (
              <div style={{ marginTop: 16, padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
                Detected: {output.meta.detectedPatterns.join(', ') || 'none'} | Confidence: {(output.meta.confidence * 100).toFixed(0)}%
              </div>
            )}
          </div>

          {output && (
            <div className="button-bar">
              <button className="btn" onClick={copyCurrentTab} data-testid="copy-btn">
                Copy Tab
              </button>
              <button className="btn" onClick={downloadReport} data-testid="download-btn">
                Download Report
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Helpers ── */

function getOutputContent(output: ConversionOutput, tab: OutputTab): string {
  switch (tab) {
    case 'mapping':
      return output.mappingMarkdown;
    case 'flows':
      return output.flowsMarkdown;
    case 'diagram':
      return output.diagramMarkdown;
    case 'checklist':
      return output.checklistMarkdown;
    case 'aiken':
      return output.aikenCode;
    case 'warnings':
      return output.warnings.join('\n');
  }
}
