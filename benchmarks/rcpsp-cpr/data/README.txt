#########################################################################################################################################
################### RCPSP Instances with high duration range with consumption and production of resources ###############################
#########################################################################################################################################

n		m		q
M_1		M_2		...		M_m		Q_1		Q_2		...		Qq
d_1		r_1_1	r_1_2	...		r_1_m	c_1_1	p_1_1	c_1_2	p_1_2	...	c_1_q	p_1_q	S_1	Succ_1_1	Succ_1_2	...	Succ_1_{S_1}
d_2		r_2_1	r_2_2	...		r_2_m	c_2_1	p_2_1	c_2_2	p_2_2	...	c_2_q	p_2_q	S_2	Succ_2_1	Succ_2_2	...	Succ_2_{S_1}
d_3		r_3_1	r_3_2	...		r_3_m	c_3_1	p_3_1	c_3_2	p_3_2	...	c_3_q	p_3_q	S_3	Succ_3_1	Succ_3_2	...	Succ_3_{S_1}
.		.		.		.		.		.		.		.		.		.	.		.		.	.			.			.	.	
.		.		.		.		.		.		.		.		.		.	.		.		.	.			.			.	.	
.		.		.		.		.		.		.		.		.		.	.		.		.	.			.			.	.	
d_n		r_n_1	r_n_2	...		r_n_m	c_n_1	p_n_1	c_n_2	p_n_2	...	c_n_q	p_n_q	S_n	Succ_n_1	Succ_n_2	...	Succ_n_{S_1}

########################################################################################################################################
######################################## DEFINITIONS SYMBOLS ##########################################################################
########################################################################################################################################
n 		: Number of activities
m 		: Number of renewable resources
q 		: Number of non-renewable resources
M_k		: Availability of renewable resource k
Q_k		: Availability of non-renewable resource k
d_i		: Task duration
r_i_k		: Requirement of activity i for the renewable resource k
c_i_k		: Requirement of activity i for the non-renewable resource k
p_i_k		: Production of activity i for the non-renewable resource k
S_k		: Number of successors of activity i 
Succ_i_j	: Successor j of activity i
#######################################################################################################################################
#################################################### BY Oumar KONE (mr.okone@gmail.com) ###############################################
#######################################################################################################################################


