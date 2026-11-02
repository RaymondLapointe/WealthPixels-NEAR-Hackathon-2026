import { expect } from "chai";
import { network } from "hardhat";

import {
  USDC_ADDRESS,
  WETH_ADDRESS,
  WBTC_ADDRESS,
  USDC_WHALE,
  WETH_WHALE,
  WBTC_WHALE,
  ERC20_ABI,
  USDC_PRICEPROVIDER,
  WETH_PRICEPROVIDER,
  WBTC_PRICEPROVIDER,
} from "../utils/constants";

const { ethers, networkHelpers } = await network.connect();

// Helper: impersonate an address + give it ETH for gas
async function impersonateAndFund(address: string, ethAmount = "10") {
  const wei = ethers.parseEther(ethAmount);
  await networkHelpers.impersonateAccount(address);
  await networkHelpers.setBalance(address, wei);
  return await ethers.getSigner(address);
}

describe("WealthToken 60/40 portfolio swap (USDC -> WETH/WBTC)", function () {
  this.timeout(120_000);

  it("funds investor with 1000 USDC, deposits 100 USDC, receives WETH/WBTC", async function () {
    const [deployer, investor1] = await ethers.getSigners();
    const investor1Address = await investor1.getAddress();

    const PriceProviderFactory = await ethers.getContractFactory(
      "ChainlinkV3PriceProvider",
      deployer
    );

    const priceProvider = await PriceProviderFactory.deploy(
      await deployer.getAddress()
    );
    const priceProviderAddress = await priceProvider.getAddress();

    const components = [WETH_ADDRESS, WBTC_ADDRESS];
    const componentProportions = [60, 40];

    const WealthTokenFactory = await ethers.getContractFactory(
      "WealthToken",
      deployer
    );

    const wealthToken = await WealthTokenFactory.deploy(
      USDC_ADDRESS,
      components,
      componentProportions,
      priceProviderAddress,
      "Wealth 60/40",
      "WP6040"
    );

    const wealthTokenAddress = await wealthToken.getAddress();

    const HEARTBEAT = 24 * 60 * 60;
    await priceProvider.setupAsset(USDC_ADDRESS, USDC_PRICEPROVIDER, HEARTBEAT);
    await priceProvider.setupAsset(WETH_ADDRESS, WETH_PRICEPROVIDER, HEARTBEAT);
    await priceProvider.setupAsset(WBTC_ADDRESS, WBTC_PRICEPROVIDER, HEARTBEAT);

    const usdcWhaleSigner = await impersonateAndFund(USDC_WHALE, "10");
    const wethWhaleSigner = await impersonateAndFund(WETH_WHALE, "10");
    const wbtcWhaleSigner = await impersonateAndFund(WBTC_WHALE, "10");

    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, usdcWhaleSigner);
    const weth = new ethers.Contract(WETH_ADDRESS, ERC20_ABI, wethWhaleSigner);
    const wbtc = new ethers.Contract(WBTC_ADDRESS, ERC20_ABI, wbtcWhaleSigner);

    const usdcAsInvestor = usdc.connect(investor1);
    const wethAsInvestor = weth.connect(investor1);
    const wbtcAsInvestor = wbtc.connect(investor1);

    const wethInventory = ethers.parseUnits("10", 18);
    const wbtcInventory = ethers.parseUnits("1", 8);

    await weth.transfer(wealthTokenAddress, wethInventory);
    await wbtc.transfer(wealthTokenAddress, wbtcInventory);

    const usdcAmountForInvestor = ethers.parseUnits("1000", 6);
    await usdc.transfer(investor1Address, usdcAmountForInvestor);

    const usdcDepositAmount = ethers.parseUnits("100", 6);

    const beforeUSDC = await usdcAsInvestor.balanceOf(investor1Address);
    const beforeWETH = await wethAsInvestor.balanceOf(investor1Address);
    const beforeWBTC = await wbtcAsInvestor.balanceOf(investor1Address);

    console.log("\n=== Investor Portfolio BEFORE Deposit ===");
    console.log("-----------------------------------");
    console.log("USDC:", ethers.formatUnits(beforeUSDC, 6));
    console.log("WETH:", ethers.formatUnits(beforeWETH, 18));
    console.log("WBTC:", ethers.formatUnits(beforeWBTC, 8));
    console.log("-----------------------------------\n");

    await usdcAsInvestor.approve(wealthTokenAddress, usdcDepositAmount);

    const tx = await wealthToken
      .connect(investor1)
      .depositToken(USDC_ADDRESS, usdcDepositAmount);
    const receipt = await tx.wait();

    const afterUSDC = await usdcAsInvestor.balanceOf(investor1Address);
    const afterWETH = await wethAsInvestor.balanceOf(investor1Address);
    const afterWBTC = await wbtcAsInvestor.balanceOf(investor1Address);

    console.log("\n=== Investor Portfolio AFTER Deposit ===");
    console.log("----------------------------------");
    console.log("USDC:", ethers.formatUnits(afterUSDC, 6));
    console.log("WETH:", ethers.formatUnits(afterWETH, 18));
    console.log("WBTC:", ethers.formatUnits(afterWBTC, 8));
    console.log("----------------------------------\n");

    const events = await wealthToken.queryFilter(
      wealthToken.filters.ComponentTransferred(),
      receipt.blockNumber,
      receipt.blockNumber
    );
    for (const ev of events) {
      console.log("ComponentTransferred event:", {
        component: ev.args.component,
        to: ev.args.to,
        amount: ev.args.amount.toString(),
        timestamp: ev.args.timestamp.toString(),
        price: ev.args.price.toString(),
      });
    }

    expect(afterWETH).to.be.gt(beforeWETH);
    expect(afterWBTC).to.be.gt(beforeWBTC);
    expect(afterUSDC).to.be.lt(beforeUSDC);

    await networkHelpers.stopImpersonatingAccount(USDC_WHALE);
    await networkHelpers.stopImpersonatingAccount(WETH_WHALE);
    await networkHelpers.stopImpersonatingAccount(WBTC_WHALE);
  });
});
