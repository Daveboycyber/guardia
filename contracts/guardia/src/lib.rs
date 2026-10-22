use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    env, near, require, AccountId, PanicOnDefault,
    serde::{Deserialize, Serialize},
    store::LookupMap,
};

/// Basic policy parameters for a protected agent
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Policy {
    /// Maximum amount (in yoctoNEAR) allowed in a single transfer
    pub max_single_transfer: u128,
    /// Maximum total amount allowed in a rolling window (simplified for MVP)
    pub max_daily_volume: u128,
    /// Whether the agent is currently frozen (blocks all outgoing transfers)
    pub is_frozen: bool,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            // 10 NEAR
            max_single_transfer: 10_000_000_000_000_000_000_000_000,
            // 50 NEAR
            max_daily_volume: 50_000_000_000_000_000_000_000_000,
            is_frozen: false,
        }
    }
}

fn parse_yocto(amount: String) -> u128 {
    amount
        .parse()
        .expect("amount must be an integer string in yoctoNEAR")
}

/// Events (NEP-297 style) for the watcher and indexers
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
}

/// Main Guardia contract — on-chain policy engine for agent money flows
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub owner_id: AccountId,
    pub agents: LookupMap<AccountId, Policy>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner_id,
            agents: LookupMap::new(b"a"),
        }
    }

    pub fn register_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        require!(
            !self.agents.contains_key(&agent_id),
            "Agent already registered"
        );

        self.agents.insert(agent_id.clone(), Policy::default());

        Event::AgentRegistered {
            agent_id: agent_id.clone(),
        }
        .emit();

        env::log_str(&format!("Registered agent: {}", agent_id));
    }

    pub fn freeze_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        let mut policy = self
            .agents
            .get(&agent_id)
            .expect("Agent not registered")
            .clone();

        policy.is_frozen = true;
        self.agents.insert(agent_id.clone(), policy);

        Event::AgentFrozen {
            agent_id: agent_id.clone(),
            by: env::predecessor_account_id(),
        }
        .emit();

        env::log_str(&format!("Frozen agent: {}", agent_id));
    }

    pub fn unfreeze_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        let mut policy = self
            .agents
            .get(&agent_id)
            .expect("Agent not registered")
            .clone();

        policy.is_frozen = false;
        self.agents.insert(agent_id.clone(), policy);

        Event::AgentUnfrozen {
            agent_id: agent_id.clone(),
            by: env::predecessor_account_id(),
        }
        .emit();

        env::log_str(&format!("Unfrozen agent: {}", agent_id));
    }

    /// Limits are decimal strings in yoctoNEAR so JSON can carry them.
    pub fn update_policy(
        &mut self,
        agent_id: AccountId,
        max_single_transfer: Option<String>,
        max_daily_volume: Option<String>,
    ) {
        self.assert_owner();
        let mut policy = self
            .agents
            .get(&agent_id)
            .expect("Agent not registered")
            .clone();

        if let Some(v) = max_single_transfer {
            policy.max_single_transfer = parse_yocto(v);
        }
        if let Some(v) = max_daily_volume {
            policy.max_daily_volume = parse_yocto(v);
        }

        self.agents.insert(agent_id.clone(), policy);

        Event::PolicyUpdated {
            agent_id: agent_id.clone(),
            by: env::predecessor_account_id(),
        }
        .emit();

        env::log_str(&format!("Updated policy for agent: {}", agent_id));
    }

    pub fn is_frozen(&self, agent_id: AccountId) -> bool {
        self.agents
            .get(&agent_id)
            .map(|p| p.is_frozen)
            .unwrap_or(false)
    }

    /// Returns (max_single_transfer, max_daily_volume, is_frozen) as decimal strings.
    pub fn get_policy(&self, agent_id: AccountId) -> Option<(String, String, bool)> {
        self.agents.get(&agent_id).map(|p| {
            (
                p.max_single_transfer.to_string(),
                p.max_daily_volume.to_string(),
                p.is_frozen,
            )
        })
    }

    /// `amount` is yoctoNEAR as a decimal string. 1 NEAR = 1000000000000000000000000
    pub fn check_transfer(&self, agent_id: AccountId, amount: String) -> (bool, String) {
        let amount = parse_yocto(amount);
        let Some(policy) = self.agents.get(&agent_id) else {
            return (false, "Agent not registered".to_string());
        };

        if policy.is_frozen {
            return (false, "Agent is frozen".to_string());
        }

        if amount > policy.max_single_transfer {
            return (
                false,
                format!(
                    "Amount {} exceeds max_single_transfer {}",
                    amount, policy.max_single_transfer
                ),
            );
        }

        (true, "Allowed".to_string())
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
            .predecessor_account_id(predecessor);
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
        assert!(!contract.is_frozen(agent()));
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
        assert!(contract.is_frozen(agent()));

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
}
