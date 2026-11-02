// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface IWealthToken{
    function getComponentsProportions() external view returns(uint256[] memory defaultComponentsProportions);
    function getComponents() external view returns(IERC20[] memory Components);
    function setComponentsProportions(uint256[] memory _componentsProportions) external;
}