/* ── Built-in Solidity examples for the Load Example buttons ── */

export const ERC20_EXAMPLE = `// SPDX-License-Identifier: MIT
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
}`;

export const ESCROW_EXAMPLE = `// SPDX-License-Identifier: MIT
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
}`;

export const LENDING_EXAMPLE = `// SPDX-License-Identifier: MIT
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
        // Simplified: anyone can liquidate if collateral ratio drops
        // In production, check oracle price feed

        loan.active = false;
        totalLiquidity += loan.collateral;
        emit Liquidated(loanId, msg.sender);
    }
}`;

export const EXAMPLES = {
  erc20: { label: 'ERC20 Token', solidity: ERC20_EXAMPLE },
  escrow: { label: 'Escrow Contract', solidity: ESCROW_EXAMPLE },
  lending: { label: 'Simple Lending', solidity: LENDING_EXAMPLE },
} as const;
