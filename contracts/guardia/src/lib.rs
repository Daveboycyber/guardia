use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    collections::LookupMap,
    env, near, AccountId, PanicOnDefault, Promise,
};

/// Basic policy parameters for an agent
#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Policy {
    /// Maximum amount (in yoctoNEAR) allowed in a single transfer
    pub max_single_transfer: u128,
    /// Maximum total amount allowed in a rolling window (simplified for MVP)
    pub max_daily_volume: u128,
    /// Whether the agent is currently frozen
    pub is_frozen: bool,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            max_single_transfer: 10_000_000_000_000_000_000_000, // 10 NEAR
            max_daily_volume: 50_000_000_000_000_000_000_000,   // 50 NEAR
            is_frozen: false,
        }
    }
}

/// Main Guardia contract
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// Owner of the Guardia instance (can manage policies)
    pub owner_id: AccountId,
    /// Registered agents and their policies
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

    /// Register a new agent under protection
    pub fn register_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        assert!(
            !self.agents.contains_key(&agent_id),
            "Agent already registered"
        );

        self.agents.insert(&agent_id, &Policy::default());
        env::log_str(&format!("Registered agent: {}", agent_id));
    }

    /// Freeze an agent (block outgoing transfers)
    pub fn freeze_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        let mut policy = self
            .agents
            .get(&agent_id)
            .expect("Agent not registered");

        policy.is_frozen = true;
        self.agents.insert(&agent_id, &policy);

        env::log_str(&format!("Frozen agent: {}", agent_id));
    }

    /// Unfreeze an agent
    pub fn unfreeze_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        let mut policy = self
            .agents
            .get(&agent_id)
            .expect("Agent not registered");

        policy.is_frozen = false;
        self.agents.insert(&agent_id, &policy);

        env::log_str(&format!("Unfrozen agent: {}", agent_id));
    }

    /// Check if an agent is currently frozen
    pub fn is_frozen(&self, agent_id: AccountId) -> bool {
        self.agents
            .get(&agent_id)
            .map(|p| p.is_frozen)
            .unwrap_or(false)
    }

    /// Get policy for an agent
    pub fn get_policy(&self, agent_id: AccountId) -> Option<Policy> {
        self.agents.get(&agent_id)
    }

    /// Simple owner check
    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Only owner can call this method"
        );
    }
}
