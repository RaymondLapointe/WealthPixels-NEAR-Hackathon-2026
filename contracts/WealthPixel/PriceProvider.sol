// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IWealthToken } from "./Interfaces/IWealthToken.sol";

contract ChainlinkV3PriceProvider is Ownable {
    using SafeMath for uint256;

    struct AssetData {
        // Time threshold to invalidate stale prices
        uint256 heartbeat;
        // Chainlink aggregator proxy
        AggregatorV3Interface aggregator;
    }

    /// @dev Address allowed to call the emergencyDisable function, can be set by the owner
    address public emergencyManager;
    address[] public componentProportions;

    /// @dev Data used for each asset
    mapping(address => AssetData) public assetData;

    event NewAggregator(address indexed asset, AggregatorV3Interface indexed aggregator);
    event NewHeartbeat(address indexed asset, uint256 heartbeat);
    event NewEmergencyManager(address indexed emergencyManager);

    error AggregatorDidNotChange();
    error AggregatorPriceNotAvailable();
    error AssetNotSupported();
    error EmergencyManagerDidNotChange();
    error EmergencyThresholdNotReached();
    error HeartbeatDidNotChange();
    error InvalidAggregator();
    error InvalidHeartbeat();
    error QuoteAggregatorHeartbeatDidNotChange();


    constructor(
        address _emergencyManager
    ){
        _setEmergencyManager(_emergencyManager);
      
    }

    /// @dev Returns price directly from aggregator using all internal settings except of fallback provider
    /// @param _asset Asset for which we want to get the price
    function getAggregatorPrice(address _asset) public view virtual returns (bool success, uint256 price, uint256 decimals) {
        (success, price , decimals) = _getAggregatorPrice(_asset);
    }
    
   
    /// @dev Sets the aggregator, fallbackProvider and heartbeat for an asset. Can only be called by the manager.
    /// @param _asset Asset to setup
    /// @param _aggregator Chainlink aggregator proxy    
    /// @param _heartbeat Threshold in seconds to invalidate a stale price
    function setupAsset(
        address _asset,
        AggregatorV3Interface _aggregator,
        uint256 _heartbeat
    ) external virtual  {
        // This has to be done first so that `_setAggregator` works
        _setHeartbeat(_asset, _heartbeat);

        if (!_setAggregator(_asset, _aggregator)) revert AggregatorDidNotChange();

    }

    /// @dev Sets the aggregator for an asset. Can only be called by the manager.
    /// @param _asset Asset for which to set the aggregator
    /// @param _aggregator Aggregator to set
    function setAggregator(address _asset, AggregatorV3Interface _aggregator)
        external
        virtual
    {
        if (!_setAggregator(_asset, _aggregator)) revert AggregatorDidNotChange();
    }

    
    /// @dev Sets the heartbeat threshold for an asset. Can only be called by the manager.
    /// @param _asset Asset for which to set the heartbeat threshold
    /// @param _heartbeat Threshold to set
    function setHeartbeat(address _asset, uint256 _heartbeat)
        external
        virtual

    {
        if (!_setHeartbeat(_asset, _heartbeat)) revert HeartbeatDidNotChange();
    }

    /// @dev Sets the emergencyManager. Can only be called by the manager.
    /// @param _emergencyManager Emergency manager to set
    function setEmergencyManager(address _emergencyManager) external virtual  {
        if (!_setEmergencyManager(_emergencyManager)) revert EmergencyManagerDidNotChange();
    }


    function _getAggregatorPrice(address _asset) internal view virtual returns (bool success, uint256 price,uint256 decimal) {
        AssetData storage data = assetData[_asset];

        uint256 heartbeat = data.heartbeat;
        AggregatorV3Interface aggregator = data.aggregator;

        if (address(aggregator) == address(0)) revert AssetNotSupported();

        (
            /*uint80 roundID*/,
            int256 aggregatorPrice,
            /*uint256 startedAt*/,
            uint256 timestamp,
            /*uint80 answeredInRound*/
        ) = aggregator.latestRoundData();

        // If a valid price is returned and it was updated recently
        if (_isValidPrice(aggregatorPrice, timestamp, heartbeat)) {
            uint256 result;
            result = uint256(aggregatorPrice);
            return (true, result, aggregator.decimals());
        }

        return (false, 0, 0);
    }

    function _setEmergencyManager(address _emergencyManager) internal virtual returns (bool changed) {
        if (_emergencyManager == emergencyManager) {
            return false;
        }

        emergencyManager = _emergencyManager;

        emit NewEmergencyManager(_emergencyManager);

        return true;
    }

    function _setAggregator(
        address _asset,
        AggregatorV3Interface _aggregator
    ) internal virtual returns (bool changed) {
        if (address(_aggregator) == address(0)) revert InvalidAggregator();

        AssetData storage data = assetData[_asset];

        if (data.aggregator == _aggregator ) {
            return false;
        }

        // There doesn't seem to be a way to verify if this is a "valid" aggregator (other than getting the price)
        data.aggregator = _aggregator;

        (bool success, , ) = _getAggregatorPrice(_asset);

        if (!success) revert AggregatorPriceNotAvailable();

        emit NewAggregator(_asset, _aggregator);

        return true;
    }

    function _setHeartbeat(address _asset, uint256 _heartbeat) internal virtual returns (bool changed) {
        // Arbitrary limit, Chainlink's threshold is always less than a day
        if (_heartbeat > 2 days) revert InvalidHeartbeat();

        if (_heartbeat == assetData[_asset].heartbeat) {
            return false;
        }

        assetData[_asset].heartbeat = _heartbeat;

        emit NewHeartbeat(_asset, _heartbeat);

        return true;
    }

    function _isValidPrice(int256 _price, uint256 _timestamp, uint256 _heartbeat) internal view virtual returns (bool) {
        return _price > 0 && block.timestamp - _timestamp < _heartbeat;
    }
    
    function setComponentsProportions(address _wealthToken, uint256[] memory _componentsProportions) onlyOwner external{
        IWealthToken(_wealthToken).setComponentsProportions(_componentsProportions);
    }

}
