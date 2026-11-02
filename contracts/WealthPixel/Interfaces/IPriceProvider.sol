// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface IPriceProvider{
    function getAggregatorPrice(address _asset) external view  returns (bool success, uint256 price, uint256 decimals);
}