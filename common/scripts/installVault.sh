#!/bin/bash -e

export COMPONENT="secrets"
export VAULT_DATA_DIR="$RUNTIME_DIR/$COMPONENT/data"
export VAULT_CONFIG_DIR="$CONFIG_DIR/$COMPONENT"
export SCRIPTS_DIR="$SCRIPTS_DIR"
export LOGS_FILE="$RUNTIME_DIR/logs/$COMPONENT.log"
export SCRIPTS_DIR_REMOTE="/tmp/shippable"

## Write logs of this script to component specific file
exec &> >(tee -a "$LOGS_FILE")

__validate_vault_envs() {
  __process_msg "Initializing vault environment variables"
  __process_msg "VAULT_IMAGE: $VAULT_IMAGE"
  __process_msg "SCRIPTS_DIR: $SCRIPTS_DIR"
  __process_msg "VAULT_DATA_DIR: $VAULT_DATA_DIR"
  __process_msg "VAULT_CONFIG_DIR: $VAULT_CONFIG_DIR"
  __process_msg "VAULT_HOST: $VAULT_HOST"
  __process_msg "VAULT_PORT: $VAULT_PORT"
  __process_msg "DBHOST: $DBHOST"
  __process_msg "DBPORT: $DBPORT"
  __process_msg "DBNAME: $DBNAME"
  __process_msg "DBUSERNAME: $DBUSERNAME"
  __process_msg "DBPASSWORD: $DBPASSWORD"
  __process_msg "LOGS_FILE: $LOGS_FILE"
}

__validate_vault_mounts() {
  __process_msg "Validating vault mounts"
  if [ ! -d "$VAULT_DATA_DIR" ]; then
    __process_msg "Creating data directory $VAULT_DATA_DIR"
    sudo mkdir -p $VAULT_DATA_DIR
  else
    __process_msg "Data directory already present: $VAULT_DATA_DIR"
  fi

  if [ ! -d "$VAULT_CONFIG_DIR" ]; then
    __process_msg "Creating config directory $VAULT_CONFIG_DIR"
    sudo mkdir -p $VAULT_CONFIG_DIR
  else
    __process_msg "Config directory already present: $VAULT_CONFIG_DIR"
  fi

  sudo mkdir -p $VAULT_CONFIG_DIR/scripts
}

__update_vault_config() {
  __process_msg "Generating vault config"
  cp -vr $SCRIPTS_DIR/configs/vault_config.hcl.template $VAULT_CONFIG_DIR/config.hcl
  cp -vr $SCRIPTS_DIR/configs/policy.hcl $VAULT_CONFIG_DIR/scripts/policy.hcl
  cp -vr $SCRIPTS_DIR/configs/vault.conf $VAULT_CONFIG_DIR/scripts/vault.conf
}

__update_vault_creds() {
  __process_msg "Updating vault to database connection credentials"

  __process_msg "Updating db host"
  sed -i 's#{{DBHOST}}#'$DBHOST'#g' $VAULT_CONFIG_DIR/config.hcl

  __process_msg "Updating db port"
  sed -i 's#{{DBPORT}}#'$DBPORT'#g' $VAULT_CONFIG_DIR/config.hcl

  __process_msg "Updating db name"
  sed -i 's#{{DBNAME}}#'$DBNAME'#g' $VAULT_CONFIG_DIR/config.hcl

  __process_msg "Updating db password"
  sed -i 's#{{DBPASSWORD}}#'$DBPASSWORD'#g' $VAULT_CONFIG_DIR/config.hcl

  __process_msg "Updating db username"
  sed -i 's#{{DBUSERNAME}}#'$DBUSERNAME'#g' $VAULT_CONFIG_DIR/config.hcl
}

__copy_configs() {
  __process_msg "Creating vault config directories"
  __process_msg "Copying vault upstart file"

  local upstart_config_path="$VAULT_CONFIG_DIR/scripts/vault.conf"
  __copy_script_remote "$VAULT_HOST" "$upstart_config_path" "/etc/init"

  local vault_config_path="$VAULT_CONFIG_DIR/config.hcl"
  __copy_script_remote "$VAULT_HOST" "$vault_config_path" "/etc/vault.d"
}

main() {
  __process_marker "Installing Vault"
  local script_name="installVault.sh"
  if [ "$IS_INSTALLED" == true ]; then
    __process_msg "Vault already installed, skipping"
  else
    __process_msg "Vault not installed"
    __validate_vault_envs
    __validate_vault_mounts
    __update_vault_config
    __update_vault_creds

    if [ "$ADMIRAL_IP" == "$VAULT_HOST" ]; then
      source "$SCRIPTS_DIR/docker/$script_name"
    else
      local script_path="$SCRIPTS_DIR/Ubuntu_14.04/$script_name"
      __check_connection "$VAULT_HOST"
      __copy_configs

      local node_update_script="$SCRIPTS_DIR/Ubuntu_14.04/setupNode.sh"
      __copy_script_remote "$VAULT_HOST" "$node_update_script" "$SCRIPTS_DIR_REMOTE"
      __exec_cmd_remote "$VAULT_HOST" "$SCRIPTS_DIR_REMOTE/setupNode.sh"

      __exec_cmd_remote "$VAULT_HOST" "mkdir -p $SCRIPTS_DIR_REMOTE"
      __copy_script_remote "$VAULT_HOST" "$script_path" "$SCRIPTS_DIR_REMOTE"

      local vault_install_cmd="VAULT_HOST=$VAULT_HOST \
        VAULT_PORT=$VAULT_PORT \
        $SCRIPTS_DIR_REMOTE/$script_name"
      __exec_cmd_remote "$VAULT_HOST" "$vault_install_cmd"
    fi
  fi
  __process_msg "Vault installed successfully"
}

main
