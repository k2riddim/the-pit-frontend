// Explicit server capabilities, not the browser's clock, control sale actions.
export function launchActions(data,{connected=false,configured=false,busy=false}={}) {
  const enabled=connected&&configured&&!busy;
  return {
    buy:enabled&&data?.status==='active'&&data?.canBuy===true,
    collect:enabled&&data?.status==='graduated'&&data?.canCollect===true,
    refund:enabled&&['active','failed'].includes(data?.status)&&data?.canRefund===true,
    excess:enabled&&data?.canWithdrawExcess===true,
    graduate:enabled&&data?.status==='active'&&data?.canGraduate===true,
  };
}
export function launchCashCopy(data) {
  const split=data?.cashSplitPercent;
  if(data?.protocol==='production-v2' && JSON.stringify(split)==='[100,0]')
    return 'All accepted ETH funds the initial liquidity pool. At $5,000 of backing, that is $5,000 of liquidity. Deployment and running costs are paid by the founder separately, and brain answers are house-sponsored. ETH price changes can alter the dollar value.';
  if(data?.protocol==='legacy-v1' && JSON.stringify(split)==='[60,20,20]')
    return 'This test sale assigns 60% of accepted ETH to liquidity, 20% to technical costs and 20% to brain answers. Dollar amounts are fixed test references, not real fundraising.';
  return 'Sale funding terms are unavailable. Check the configured contract before purchasing.';
}
