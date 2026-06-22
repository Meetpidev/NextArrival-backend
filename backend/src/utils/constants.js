const SUBSCRIPTION_PLANS = [
  {
    id: "plan-1",
    name: "Starter",
    priceOneTime: 29,
    priceSub: 19,
    durationDays: 14,
    approachesLimit: 5,
  },
  {
    id: "plan-2",
    name: "Mover",
    priceOneTime: 39,
    priceSub: 29,
    durationDays: 30,
    approachesLimit: 15,
  },
  {
    id: "plan-featured",
    name: "Priority",
    priceOneTime: 89,
    priceSub: 79,
    durationDays: 60,
    approachesLimit: -1,
  },
];

const URGENT_MATCH_ADDON = { price: 99 };

module.exports = { SUBSCRIPTION_PLANS, URGENT_MATCH_ADDON };
