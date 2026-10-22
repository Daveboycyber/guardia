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
            max_single_transfer: 10_000_000_000_000_000_000_000,
            // 50 NEAR
            max_daily_volume: 50_000_000_000_000_000_000_000,
            is_frozen: false,
        }
    }
}

/// Events (NEP-297 style) for the watcher and indexers
#[near(event_json(standard = "guardia"))]
pub enum Event {
    #[event_version("1.0.0")]
    AgentRegistered {
        agent_id: AccountId,
    },
    #[event_version("1.0.0")]
    AgentFrozen {
        agent_id: AccountId,
        by: AccountId,
    },
    #[event_version("1.0.0")]
    AgentUnfrozen {
        agent_id: AccountId,
        by: AccountId,
    },
    #[event_version("1.0.0")]
    PolicyUpdated {
        agent_id: AccountId,
        by: AccountId,
    },
}

/// Main Guardia contract — on-chain policy engine for agent money flows
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// Owner of this Guardia instance (can manage policies and freeze)
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

    // ─── Owner-only management ────────────────────────────────

    /// Register a new agent under protection
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

    /// Freeze an agent (block all outgoing transfers)
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

    /// Unfreeze an agent
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

    /// Update policy parameters for an agent
    pub fn update_policy(
        &mut self,
        agent_id: AccountId,
        max_single_transfer: Option<u128>,
        max_daily_volume: Option<u128>,
    ) {
        self.assert_owner();
        let mut policy = self
            .agents
            .get(&agent_id)
            .expect("Agent not registered")
            .clone();

        if let Some(v) = max_single_transfer {
            policy.max_single_transfer = v;
        }
        if let Some(v) = max_daily_volume {
            policy.max_daily_volume = v;
        }

        self.agents.insert(agent_id.clone(), policy);

        Event::PolicyUpdated {
            agent_id: agent_id.clone(),
            by: env::predecessor_account_id(),
        }
        .emit();

        env::log_str(&format!("Updated policy for agent: {}", agent_id));
    }

    // ─── View methods ───────────────────────────────────────

    /// Check if an agent is currently frozen
    pub fn is_frozen(&self, agent_id: AccountId) -> bool {
        self.agents
            .get(&agent_id)
            .map(|p| p.is_frozen)
            .unwrap_or(false)
    }

    /// Get the full policy for an agent
    /// Returns (max_single_transfer, max_daily_volume, is_frozen) or None if not registered
    pub fn get_policy(&self, agent_id: AccountId) -> Option<(u128, u128, bool)> {
        self.agents.get(&agent_id).map(|p| {
            (p.max_single_transfer, p.max_daily_volume, p.is_frozen)
        })
    }

    /// Check whether a proposed transfer would currently be allowed
    /// Returns (allowed: bool, reason: String)
    pub fn check_transfer(
        &self,
        agent_id: AccountId,
        amount: u128,
    ) -> (bool, String) {
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

        // Note: real daily volume tracking will be added later (needs timestamps)
        // For MVP we only enforce single-transfer + frozen flag

        (true, "Allowed".to_string())
    }

    // ─── Internal helpers ───────────────────────────────────

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only owner can call this method"
        );
    }
}
