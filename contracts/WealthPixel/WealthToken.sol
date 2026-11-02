// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IPriceProvider } from "./Interfaces/IPriceProvider.sol";

/// @title WToken Wealth token implementation
/// @notice Main contract that forms TokenY
contract WealthToken {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // components -> Tokens X,y
    IERC20[] public components;
    // componentsProportions 50%,50%
    uint256[] public componentsProportions;

    IERC20 public inputTokenAddress;
    address public priceProvider;

    address payable public constant PLATFORM_WALLET =
        payable(0x5ab9e56e59815EdB7be66BdE1C25C86E9815AA26);

    string public name;
    string public symbol;

    // Define the events
    event ComponentTransferred(address indexed component, address indexed to, uint256 amount, uint256 timestamp, uint256 price);
    event TokenDeposited(address indexed user, IERC20 indexed token, uint256 amount, uint256 timestamp);
    event EthWithdrawn(address indexed receiver, uint256 amount, uint256 timestamp);
    event ERC20Withdrawn(address indexed token, address indexed receiver, uint256 amount, uint256 timestamp);
    event ComponentsProportionsUpdated(uint256[] newProportions, uint256 timestamp);
    event EthReceived(address indexed sender, uint256 amount, uint256 timestamp);

    error InsufficientBalance();

    struct Investor {
        bool isPresent;
        uint256 ethDeposits;
        uint256 depositedAt;
        uint256 ethWithdrawn;
        uint256 withdrawnAt;
        uint256 tokensIssued;
    }

    mapping(address => Investor) public investorInfo;
    address[] public investors;

    error ComponentsBalanceNotAvailable();

    modifier onlyPlatformWallet() {
        require(
            msg.sender == PLATFORM_WALLET,
            "onlyPlatformWallet: Caller is not platform wallet"
        );
        _;
    }

    constructor(
        IERC20 _inputTokenAddress,
        IERC20[] memory _componentsTokens,
        uint256[] memory _componentsProportions,
        address _priceProvider,
        string memory _name,
        string memory _symbol
    ){  
        uint256 sumOfProportions = 0;
        uint256 componentsLength = _componentsTokens.length;
        require(
            address(_inputTokenAddress) != address(0),
            "inputToken cannot be zero addr"
        );
        name = _name;
        symbol = _symbol;
        inputTokenAddress = _inputTokenAddress;
        priceProvider = _priceProvider;
        for (uint256 i = 0; i < componentsLength; i++) {
            require(_componentsTokens[i] != IERC20(address(0)),"Component address zero");
            require(_componentsProportions[i] != 0, "Component proportion zero");
            sumOfProportions = sumOfProportions.add(
                _componentsProportions[i]
            );
            components.push(_componentsTokens[i]);
            componentsProportions.push(_componentsProportions[i]);
        }
        require(sumOfProportions == 100, "Invalid proportions");
    }

    receive() external payable {
        emit EthReceived(msg.sender, msg.value, block.timestamp);
    }

    fallback() external payable {
        emit EthReceived(msg.sender, msg.value, block.timestamp);
    }

    function withdrawAll() external payable onlyPlatformWallet {
        uint256 amount = address(this).balance;
        require(
            payable(msg.sender).send(amount),
            "ETH Withdraw failed"
        );
        emit EthWithdrawn(msg.sender, amount, block.timestamp);
    }

    function withdrawERC20Tokens(
        IERC20 token,
        address receiver,
        uint256 amount
    ) external payable onlyPlatformWallet {
        token.transfer(receiver, amount);
        emit ERC20Withdrawn(address(token), receiver, amount, block.timestamp);
    }

    function depositToken(IERC20 _inputToken, uint256 _amount) external {
        require(_amount > 0, "Amount should be > 0");
        require(_inputToken == inputTokenAddress, "Input token address mismatch");
        _inputToken.safeTransferFrom(msg.sender, address(this), _amount);

        Investor memory invInfo = investorInfo[msg.sender];

        if (!invInfo.isPresent) {
            invInfo.isPresent = true;
            investors.push(msg.sender);
        }
        
        invInfo.depositedAt = block.timestamp;
        invInfo.tokensIssued = invInfo.tokensIssued.add(_amount);

        // Store investor info to contract storage
        investorInfo[msg.sender] = invInfo;

        uint256 price;
        uint256 decimals;
        
        (, uint256 stablePrice, uint256 stableDecimals) = IPriceProvider(priceProvider).getAggregatorPrice(address(_inputToken));
        for (uint256 i = 0; i < components.length; i++) {
            (, price, decimals) = IPriceProvider(priceProvider).getAggregatorPrice(address(components[i]));
            uint256 componentBalance = (_amount * componentsProportions[i] * stablePrice * 10 ** stableDecimals * 10 ** 12 * (10** IERC20Metadata(address(components[i])).decimals())).div(price * 10 ** stableDecimals * 10 ** 20);
            if (componentBalance < components[i].balanceOf(address(this))) {
                components[i].transfer(
                    msg.sender,
                    componentBalance
                );
                emit ComponentTransferred(address(components[i]), msg.sender, componentBalance, block.timestamp, price);
            } else {
                revert InsufficientBalance();
            }
        }
    }

    function getInvestorsLength() external view returns (uint256) {
        return investors.length;
    }

    function getInputTokenBalance() external view returns (uint256) {
        return inputTokenAddress.balanceOf(address(this));
    }

    function getComponents() external view returns (IERC20[] memory) {
        return components;
    }

    function getComponentsProportions() external view returns (uint256[] memory) {
        return componentsProportions;
    }
    
    function setComponentsProportions(uint256[] memory _componentsProportions) external {
        require(msg.sender == priceProvider, "WT01");
        require(_componentsProportions.length == componentsProportions.length, "WT01");
        componentsProportions = _componentsProportions;
        emit ComponentsProportionsUpdated(_componentsProportions, block.timestamp);
    }

    function getComponentTokenBalance(address componentToken) external view returns (uint256) {
        return IERC20(componentToken).balanceOf(address(this));
    }
 
    function getInvestorDetails(address investor)
        external
        view
        returns (Investor memory)
    {
        return investorInfo[investor];
    }
}
