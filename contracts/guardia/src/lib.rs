use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    env, near, require, AccountId, PanicOnDefault,
    serde::{Deserialize, Serialize},
    store::{LookupMap, Vector},
};

/// Nanoseconds in a UTC day. Volume resets when this bucket changes.
const NS_PER_DAY: u64 = 86_400_000_000_000;

fn current_day() -> u64 {
    env::block_timestamp() / NS_PER_DAY
}

fn parse_yocto(amount: String) -> u128 {
    amount
        .parse()
        .expect("amount must be an integer string in yoctoNEAR")
}

/// Policy for one protected agent. `spent_today` is the amount already
/// committed in `epoch_day` (block_timestamp / 1 day).
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Policy {
    pub max_single_transfer: u128,
    pub max_daily_volume: u128,
    pub is_frozen: bool,
    pub spent_today: u128,
    pub epoch_day: u64,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            max_single_transfer: 10_000_000_000_000_000_000_000_000,
            max_daily_volume: 50_000_000_000_000_000_000_000_000,
            is_frozen: false,
            spent_today: 0,
            epoch_day: 0,
        }
    }
}

impl Policy {
    fn spent_now(&self) -> u128 {
        if self.epoch_day != current_day() {
            0
        } else {
            self.spent_today
        }
    }

    fn remaining(&self) -> u128 {
        self.max_daily_volume.saturating_sub(self.spent_now())
    }

    /// Preview only. Does not write the day rollover.
    fn evaluate(&self, amount: u128) -> Result<(), String> {
        if self.is_frozen {
            return Err("Agent is frozen".to_string());
        }
        if amount > self.max_single_transfer {
            return Err(format!(
                "Amount {} exceeds max_single_transfer {}",
                amount, self.max_single_transfer
            ));
        }
        let spent = self.spent_now();
        if spent.saturating_add(amount) > self.max_daily_volume {
            return Err(format!(
                "Amount {} would exceed max_daily_volume {} (spent today {})",
                amount, self.max_daily_volume, spent
            ));
        }
        Ok(())
    }

    fn roll_day(&mut self) {
        let day = current_day();
        if self.epoch_day != day {
            self.epoch_day = day;
            self.spent_today = 0;
        }
    }
}

#[near(event_json(standard = "guardia"))]
pub enum Event {
    #[event_version("1.0.0")]
    AgentRegistered { agent_id: AccountId },
    #[event_version("1.0.0")]
    AgentFrozen { agent_id: AccountId, by: AccountId },
    #[event_version("1.0.0")]
    AgentUnfrozen { agent_id: AccountId, by: AccountId },
    #[event_version("1.0.0")]
    PolicyUpdated { agent_id: AccountId, by: AccountId },
    #[event_version("1.0.0")]
    SpendCommitted {
        agent_id: AccountId,
        amount: String,
        spent_today: String,
        by: AccountId,
    },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub owner_id: AccountId,
    pub agents: LookupMap<AccountId, Policy>,
    pub agent_ids: Vector<AccountId>,
}

/// Layout deployed before daily accounting existed.
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct PolicyV1 {
    max_single_transfer: u128,
    max_daily_volume: u128,
    is_frozen: bool,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct StateV1 {
    owner_id: AccountId,
    agents: LookupMap<AccountId, PolicyV1>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner_id,
            agents: LookupMap::new(b"p"),
            agent_ids: Vector::new(b"i"),
        }
    }

    /// One-shot upgrade from the v1 state on `skar.testnet`.
    /// Pass every agent that should be kept; LookupMap cannot be scanned.
    #[init(ignore_state)]
    pub fn migrate(agent_ids: Vec<AccountId>) -> Self {
        let old: StateV1 = env::state_read().expect("no v1 state to migrate");
        let mut contract = Self {
            owner_id: old.owner_id,
            agents: LookupMap::new(b"p"),
            agent_ids: Vector::new(b"i"),
        };
        for agent_id in agent_ids {
            let Some(prev) = old.agents.get(&agent_id) else {
                continue;
            };
            contract.agents.insert(
                agent_id.clone(),
                Policy {
                    max_single_transfer: prev.max_single_transfer,
                    max_daily_volume: prev.max_daily_volume,
                    is_frozen: prev.is_frozen,
                    spent_today: 0,
                    epoch_day: current_day(),
                },
            );
            contract.agent_ids.push(agent_id);
        }
        contract
    }

    pub fn register_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        require!(
            !self.agents.contains_key(&agent_id),
            "Agent already registered"
        );
        let mut policy = Policy::default();
        policy.epoch_day = current_day();
        self.agents.insert(agent_id.clone(), policy);
        self.agent_ids.push(agent_id.clone());
        Event::AgentRegistered { agent_id }.emit();
    }

    pub fn freeze_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        let mut policy = self.take_policy(&agent_id);
        policy.is_frozen = true;
        self.agents.insert(agent_id.clone(), policy);
        Event::AgentFrozen {
            agent_id,
            by: env::predecessor_account_id(),
        }
        .emit();
    }

    pub fn unfreeze_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        let mut policy = self.take_policy(&agent_id);
        policy.is_frozen = false;
        self.agents.insert(agent_id.clone(), policy);
        Event::AgentUnfrozen {
            agent_id,
            by: env::predecessor_account_id(),
        }
        .emit();
    }

    pub fn update_policy(
        &mut self,
        agent_id: AccountId,
        max_single_transfer: Option<String>,
        max_daily_volume: Option<String>,
    ) {
        self.assert_owner();
        let mut policy = self.take_policy(&agent_id);
        if let Some(v) = max_single_transfer {
            policy.max_single_transfer = parse_yocto(v);
        }
        if let Some(v) = max_daily_volume {
            policy.max_daily_volume = parse_yocto(v);
        }
        self.agents.insert(agent_id.clone(), policy);
        Event::PolicyUpdated {
            agent_id,
            by: env::predecessor_account_id(),
        }
        .emit();
    }

    /// Preview a payment. Does not move funds and does not count toward the daily cap.
    pub fn check_transfer(&self, agent_id: AccountId, amount: String) -> (bool, String) {
        let amount = parse_yocto(amount);
        let Some(policy) = self.agents.get(&agent_id) else {
            return (false, "Agent not registered".to_string());
        };
        match policy.evaluate(amount) {
            Ok(()) => (true, "Allowed".to_string()),
            Err(reason) => (false, reason),
        }
    }

    /// Record a payment that already passed policy. Callable by the owner or the agent.
    /// This is what actually consumes the daily budget.
    pub fn commit_spend(&mut self, agent_id: AccountId, amount: String) -> (bool, String) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id || caller == agent_id,
            "Only owner or the agent can commit spend"
        );
        let amount_u128 = parse_yocto(amount.clone());
        let Some(mut policy) = self.agents.get(&agent_id).cloned() else {
            return (false, "Agent not registered".to_string());
        };
        if let Err(reason) = policy.evaluate(amount_u128) {
            return (false, reason);
        }
        policy.roll_day();
        policy.spent_today = policy.spent_today.saturating_add(amount_u128);
        let spent = policy.spent_today.to_string();
        self.agents.insert(agent_id.clone(), policy);
        Event::SpendCommitted {
            agent_id,
            amount,
            spent_today: spent.clone(),
            by: caller,
        }
        .emit();
        (true, format!("Committed. spent_today {spent}"))
    }

    pub fn is_frozen(&self, agent_id: AccountId) -> bool {
        self.agents
            .get(&agent_id)
            .map(|p| p.is_frozen)
            .unwrap_or(false)
    }

    /// (max_single, max_daily, is_frozen) — unchanged so the current UI keeps working.
    pub fn get_policy(&self, agent_id: AccountId) -> Option<(String, String, bool)> {
        self.agents.get(&agent_id).map(|p| {
            (
                p.max_single_transfer.to_string(),
                p.max_daily_volume.to_string(),
                p.is_frozen,
            )
        })
    }

    /// (spent_today, remaining_today, epoch_day) as decimal strings.
    pub fn get_usage(&self, agent_id: AccountId) -> Option<(String, String, String)> {
        self.agents.get(&agent_id).map(|p| {
            (
                p.spent_now().to_string(),
                p.remaining().to_string(),
                current_day().to_string(),
            )
        })
    }

    pub fn list_agents(&self) -> Vec<AccountId> {
        self.agent_ids.iter().cloned().collect()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    fn take_policy(&self, agent_id: &AccountId) -> Policy {
        self.agents
            .get(agent_id)
            .expect("Agent not registered")
            .clone()
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only owner can call this method"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    fn yocto(amount: u128) -> String {
        amount.to_string()
    }

    fn owner() -> AccountId {
        "owner.testnet".parse().unwrap()
    }

    fn agent() -> AccountId {
        "agent.testnet".parse().unwrap()
    }

    fn set_predecessor(predecessor: AccountId) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("guardia.testnet".parse().unwrap())
            .predecessor_account_id(predecessor)
            .block_timestamp(NS_PER_DAY * 3);
        testing_env!(builder.build());
    }

    fn setup() -> Contract {
        set_predecessor(owner());
        let mut contract = Contract::new(owner());
        contract.register_agent(agent());
        contract
    }

    #[test]
    fn owner_can_register_and_read_default_policy() {
        let contract = setup();
        let policy = contract.get_policy(agent()).expect("registered");
        assert_eq!(policy.0, yocto(10 * ONE_NEAR));
        assert_eq!(policy.1, yocto(50 * ONE_NEAR));
        assert!(!policy.2);
        assert_eq!(contract.list_agents(), vec![agent()]);
        let usage = contract.get_usage(agent()).unwrap();
        assert_eq!(usage.0, "0");
        assert_eq!(usage.1, yocto(50 * ONE_NEAR));
    }

    #[test]
    #[should_panic(expected = "Only owner can call this method")]
    fn non_owner_cannot_register() {
        set_predecessor(owner());
        let mut contract = Contract::new(owner());
        set_predecessor("stranger.testnet".parse().unwrap());
        contract.register_agent(agent());
    }

    #[test]
    fn check_transfer_allows_under_limit_and_blocks_over() {
        let contract = setup();
        let (ok, reason) = contract.check_transfer(agent(), yocto(ONE_NEAR));
        assert!(ok, "{reason}");
        let (ok, reason) = contract.check_transfer(agent(), yocto(11 * ONE_NEAR));
        assert!(!ok);
        assert!(reason.contains("exceeds"));
    }

    #[test]
    fn freeze_blocks_even_small_transfers() {
        let mut contract = setup();
        set_predecessor(owner());
        contract.freeze_agent(agent());
        let (ok, reason) = contract.check_transfer(agent(), yocto(ONE_NEAR));
        assert!(!ok);
        assert_eq!(reason, "Agent is frozen");
        set_predecessor(owner());
        contract.unfreeze_agent(agent());
        let (ok, _) = contract.check_transfer(agent(), yocto(ONE_NEAR));
        assert!(ok);
    }

    #[test]
    fn unknown_agent_is_rejected() {
        set_predecessor(owner());
        let contract = Contract::new(owner());
        let (ok, reason) = contract.check_transfer(agent(), yocto(ONE_NEAR));
        assert!(!ok);
        assert_eq!(reason, "Agent not registered");
    }

    #[test]
    fn daily_cap_blocks_after_commits() {
        let mut contract = setup();
        set_predecessor(owner());
        let (ok, reason) = contract.commit_spend(agent(), yocto(30 * ONE_NEAR));
        assert!(ok, "{reason}");
        let (ok, reason) = contract.commit_spend(agent(), yocto(25 * ONE_NEAR));
        assert!(!ok);
        assert!(reason.contains("max_daily_volume"));
        let (preview_ok, _) = contract.check_transfer(agent(), yocto(25 * ONE_NEAR));
        assert!(!preview_ok);
        let (still_ok, _) = contract.check_transfer(agent(), yocto(10 * ONE_NEAR));
        assert!(still_ok);
    }

    #[test]
    fn spend_resets_on_the_next_day() {
        let mut contract = setup();
        set_predecessor(owner());
        let (ok, _) = contract.commit_spend(agent(), yocto(40 * ONE_NEAR));
        assert!(ok);

        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("guardia.testnet".parse().unwrap())
            .predecessor_account_id(owner())
            .block_timestamp(NS_PER_DAY * 4);
        testing_env!(builder.build());

        let (ok, reason) = contract.commit_spend(agent(), yocto(40 * ONE_NEAR));
        assert!(ok, "{reason}");
        let usage = contract.get_usage(agent()).unwrap();
        assert_eq!(usage.0, yocto(40 * ONE_NEAR));
    }

    #[test]
    #[should_panic(expected = "Only owner or the agent can commit spend")]
    fn stranger_cannot_commit() {
        let mut contract = setup();
        set_predecessor("stranger.testnet".parse().unwrap());
        contract.commit_spend(agent(), yocto(ONE_NEAR));
    }
}
